/***********************************************
 * analysis.js - Handles email analysis and 
 *               results display
 ***********************************************/
const AnalysisModule = (function() {
    // Module state
    const state = {
      currentAnalysis: null,
      isAnalyzing: false
    };
    
    // Initialize module
    async function init() {
      // Subscribe to events
      if (window.EventBus) {
        console.log("Setting up EventBus subscriptions for analysis module");
        window.EventBus.subscribe('analysis:start', handleAnalysisStart);
        window.EventBus.subscribe('analysis:complete', displayResults);
        window.EventBus.subscribe('analysis:error', handleAnalysisError);
      } else {
        console.error("EventBus not available when initializing analysis module");
      }
      
      // Also listen for the app:startAnalysis event directly
      if (window.EventBus) {
        window.EventBus.subscribe('app:startAnalysis', () => {
          console.log("Received app:startAnalysis event in analysis module");
          startAnalysis().catch(err => {
            console.error("startAnalysis failed:", err);
          });
        });
      }
      
      console.log('Analysis module initialized');
      return true;
    }
    
    // Mount the module
    async function mount(container) {
      console.log('Mounting analysis module');
      try {
        // Load HTML template
        const response = await fetch('modules/analysis/analysis.html');
        const html = await response.text();
        container.innerHTML = html;
        
        // Set up event handlers
        const savePdfBtn = document.getElementById('savePdfBtn');
        if (savePdfBtn) {
          savePdfBtn.addEventListener('click', exportAnalysisAsPdf);
        }
        
        // Render history
        renderHistory();
        
        console.log('Analysis module mounted successfully');
      } catch (error) {
        console.error('Error mounting analysis module:', error);
      }
    }
    
    // Unmount the module
    function unmount() {
      // Clean up event handlers
      console.log('Analysis module unmounted');
    }
    
    /**
     * Now returns a Promise so that external code calling
     * startAnalysis().then(...) won’t fail.
     */
    function startAnalysis() {
      return new Promise((resolve, reject) => {
        // Validate API key is set
        if (!window.ConfigService) {
          console.error("ConfigService not available");
          if (window.NotificationService) {
            window.NotificationService.error("Configuration service not available");
          }
          return reject(new Error("Configuration service not available"));
        }
        
        const config = window.ConfigService.getApiConfig();
        if (!config.apiKey) {
          if (window.NotificationService) {
            window.NotificationService.warning('Please configure your API key in settings');
          }
          if (window.ModalModules) {
            window.ModalModules.showModal('settings');
          }
          return reject(new Error("No API key configured"));
        }
        
        // Get message content
        const messageEl = document.getElementById('messageText');
        if (!messageEl) {
          console.error("Message text element not found");
          return reject(new Error("Message text element not found"));
        }
        
        const messageContent = messageEl.value.trim();
        if (!messageContent) {
          if (window.NotificationService) {
            window.NotificationService.error('Please provide message content to analyze');
          }
          return reject(new Error("No message content provided"));
        }
        
        console.log("Starting analysis with content length:", messageContent.length);
        
        // Set analyzing state
        state.isAnalyzing = true;
        
        // Trigger analysis start event
        if (window.EventBus) {
          console.log("Publishing analysis:start event");
          window.EventBus.publish('analysis:start', {
            content: messageContent,
            apiKey: config.apiKey,
            model: config.model
          });
          // Resolve immediately; the actual steps run in handleAnalysisStart
          resolve();
        } else {
          console.log("EventBus not available, calling handleAnalysisStart directly");
          handleAnalysisStart({
            content: messageContent,
            apiKey: config.apiKey,
            model: config.model
          })
          .then(() => resolve())
          .catch(err => reject(err));
        }
      });
    }
    
    /**
     * Called when 'analysis:start' is published.  
     * Also returns a Promise so the calling code can chain off it if needed.
     */
    function handleAnalysisStart(data) {
      console.log("Analysis start handler called with data:", !!data);
      
      if (!data || !data.content) {
        console.error("Invalid data received for analysis:start event");
        if (window.NotificationService) {
          window.NotificationService.error('Invalid analysis data received');
        }
        // Return a rejected Promise to maintain consistent promise flow
        return Promise.reject(new Error("Invalid analysis data received"));
      }
      
      state.isAnalyzing = true;
      state.currentAnalysis = {
        content: data.content,
        startTime: new Date(),
        results: {}
      };
      
      // Show spinner and progress
      showSpinner("Starting analysis...");
      updateProgressBar(0, 1);
      
      // Clear previous results (with null checks to avoid errors)
      clearResults();
      
      console.log("Starting analysis steps with content length:", data.content.length);
      
      return runAnalysisSteps(data.content, data.apiKey, data.model)
        .then(results => {
          console.log("Analysis completed successfully");
          state.currentAnalysis.results = results;
          state.currentAnalysis.endTime = new Date();
          state.isAnalyzing = false;
          
          if (window.EventBus) {
            window.EventBus.publish('analysis:complete', {
              content: data.content,
              results,
              startTime: state.currentAnalysis.startTime,
              endTime: state.currentAnalysis.endTime
            });
          }
        })
        .catch(error => {
          console.error("Analysis failed:", error);
          state.isAnalyzing = false;
          hideSpinner();
          
          if (window.NotificationService) {
            window.NotificationService.error('Analysis failed: ' + error.message);
          }
          
          if (window.EventBus) {
            window.EventBus.publish('analysis:error', {
              error,
              content: data.content
            });
          }
          
          // Re-throw so the caller can handle it
          throw error;
        });
    }
    
    /**
     * Called when 'analysis:error' is published.
     */
    function handleAnalysisError(data) {
      hideSpinner();
      if (window.NotificationService && data && data.error) {
        window.NotificationService.error('Analysis failed: ' + data.error.message);
      }
      console.error('Analysis error:', data ? data.error : '(no data)');
    }
    
    /**
     * Actually runs the multi-step analysis logic.
     */
    async function runAnalysisSteps(messageContent, apiKey, model) {
      try {
        console.log("Loading steps from StepService...");
        // Get steps from StepService
        let steps = [];
        
        if (window.StepService) {
          steps = await window.StepService.getSteps();
          console.log(`Loaded ${steps.length} steps from StepService`);
        } else {
          console.warn("StepService not available, using default step");
        }
        
        if (!steps || steps.length === 0) {
          console.log("No steps found, creating default step");
          // Create a default step if none are configured
          steps = [{
            id: "default_analysis",
            menuName: "Basic Analysis",
            position: 0,
            isVirtual: true, 
            content: {
              stepPrompt: "Analyze the following email content for potential phishing or security threats:\n\n{message_content}",
              llmInstructions: "Provide a detailed analysis identifying any suspicious elements, potential phishing attempts, or security concerns. Format your response with clear sections.\n\n[Response]\nYour detailed analysis goes here.\n[Response Summary]\nA brief summary of your findings."
            },
            dependencies: []
          }];
        }
        
        updateProgressBar(0, steps.length);
        
        let stepResults = {};
        
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const stepNumber = i + 1;
          
          console.log(`Processing step ${stepNumber}/${steps.length}: ${step.menuName}`);
          updateProgressBar(stepNumber - 1, steps.length);
          showSpinner(`Running Step ${stepNumber}: ${step.menuName}...`);
          
          try {
            let prompt = step.content.stepPrompt;
            prompt = prompt.replace("{message_content}", messageContent);
            
            // Replace variables from previous steps
            steps.forEach(prevStep => {
              const outputKey = `${prevStep.id}_output`;
              const summaryKey = `${prevStep.id}_summary`;
              if (stepResults[outputKey]) {
                const regex = new RegExp(`{${outputKey}}`, 'g');
                prompt = prompt.replace(regex, stepResults[outputKey]);
              }
              if (stepResults[summaryKey]) {
                const regex = new RegExp(`{${summaryKey}}`, 'g');
                prompt = prompt.replace(regex, stepResults[summaryKey]);
              }
            });
            
            prompt += "\n\n" + step.content.llmInstructions;
            
            console.log(`Calling API for step ${step.id}`);
            if (!window.ApiService) {
              throw new Error("API service not available");
            }
            
            const openaiResponse = await window.ApiService.callOpenAI(prompt, apiKey, model);
            console.log(`Got API response for step ${step.id}, parsing response`);
            
            const { responseContent, responseSummary } = window.ApiService.parseLLMResponse(openaiResponse);
            
            stepResults[`${step.id}_output`] = responseContent;
            stepResults[`${step.id}_summary`] = responseSummary;
            
            // Display the result
            displayResult({
              stepId: step.id,
              menuName: step.menuName,
              output: responseContent,
              summary: responseSummary,
              stepNumber,
              totalSteps: steps.length
            });
          } catch (stepError) {
            console.error(`Error in step ${step.id}:`, stepError);
            // Continue to next step but track the error
            stepResults[`${step.id}_output`] = `Error: ${stepError.message}`;
            stepResults[`${step.id}_summary`] = "An error occurred during analysis.";
            
            // Display error result
            displayResult({
              stepId: step.id,
              menuName: step.menuName,
              output: `Error: ${stepError.message}\n\nPlease check your API key and settings, then try again.`,
              summary: "Analysis failed for this step.",
              stepNumber,
              totalSteps: steps.length
            });
          }
        }
        
        updateProgressBar(steps.length, steps.length);
        hideSpinner();
        
        if (window.NotificationService) {
          window.NotificationService.success("Analysis completed successfully!");
        }
        
        // Save to history
        if (window.HistoryService) {
          window.HistoryService.saveAnalysis(messageContent, stepResults);
        }
        renderHistory();
        
        // Show export button
        const exportContainer = document.getElementById('exportContainer');
        if (exportContainer) {
          exportContainer.classList.remove('hidden');
        }
        
        return stepResults;
      } catch (error) {
        console.error("Error in runAnalysisSteps:", error);
        hideSpinner();
        throw error;
      }
    }
    
    /**
     * Display the final results event if needed (analysis:complete).
     */
    function displayResults(data) {
      // Step-by-step results are already displayed in displayResult.
      // We can do final updates here if needed:
      const exportContainer = document.getElementById('exportContainer');
      if (exportContainer) {
        exportContainer.classList.remove('hidden');
      }
    }
    
    /**
     * Clear previous results. Now with null checks
     * to avoid reading classList of a null element.
     */
    function clearResults() {
      const resultTabs = document.getElementById('resultTabs');
      const resultTabsContent = document.getElementById('resultTabsContent');
      const emptyResultsMessage = document.getElementById('emptyResultsMessage');
      const exportContainer = document.getElementById('exportContainer');
      
      if (resultTabs) {
        resultTabs.innerHTML = '';
      }
      if (resultTabsContent) {
        resultTabsContent.innerHTML = '';
      }
      if (emptyResultsMessage) {
        emptyResultsMessage.classList.remove('hidden');
      }
      if (exportContainer) {
        exportContainer.classList.add('hidden');
      }
    }
    
    /**
     * Display a single result step in a tab.
     */
    function displayResult(result) {
      // Hide empty message
      const emptyResultsMessage = document.getElementById('emptyResultsMessage');
      if (emptyResultsMessage) {
        emptyResultsMessage.classList.add('hidden');
      }
      
      const tabId = `content-${result.stepId}`;
      const resultTabs = document.getElementById('resultTabs');
      const resultContent = document.getElementById('resultTabsContent');
      
      if (!resultTabs || !resultContent) {
        return; // The module might not be mounted yet
      }
      
      // Check if tab already exists
      if (document.getElementById(`tab-${result.stepId}`)) {
        // Update existing tab content
        const existingTabContent = document.getElementById(tabId);
        if (existingTabContent) {
          const mdOutput = marked.parse(result.output || "");
          const sanitizedOutput = DOMPurify.sanitize(mdOutput);
          const mdSummary = marked.parse(result.summary || "");
          const sanitizedSummary = DOMPurify.sanitize(mdSummary);
          
          existingTabContent.querySelector('.result-summary').innerHTML = sanitizedSummary;
          existingTabContent.querySelector('.result-content').innerHTML = sanitizedOutput;
        }
        return;
      }
      
      // Create new tab
      const tabLink = document.createElement('a');
      tabLink.id = `tab-${result.stepId}`;
      tabLink.href = `#${tabId}`;
      tabLink.className = 'text-gray-500 hover:text-gray-700 hover:border-gray-300 px-4 py-2 font-medium text-sm border-b-2 border-transparent transition-all duration-200';
      tabLink.setAttribute('role', 'tab');
      tabLink.textContent = result.menuName;
      resultTabs.appendChild(tabLink);
      
      const mdOutput = marked.parse(result.output || "");
      const sanitizedOutput = DOMPurify.sanitize(mdOutput);
      const mdSummary = marked.parse(result.summary || "");
      const sanitizedSummary = DOMPurify.sanitize(mdSummary);
      
      // Create tab content
      const tabContent = document.createElement('div');
      tabContent.id = tabId;
      tabContent.className = 'tab-pane';
      tabContent.setAttribute('role', 'tabpanel');
      tabContent.style.display = 'none';
      
      tabContent.innerHTML = `
        <h3 class="text-xl font-semibold text-gray-800 mb-3">${DOMPurify.sanitize(result.menuName)}</h3>
        <div class="mb-4 bg-gray-50 p-4 rounded-md border border-gray-200 result-summary">
          <h4 class="text-base font-medium text-gray-700 mb-2">Summary</h4>
          ${sanitizedSummary}
        </div>
        <div class="prose max-w-none result-content">
          ${sanitizedOutput}
        </div>
      `;
      
      resultContent.appendChild(tabContent);
      
      // Set up tab switching
      tabLink.addEventListener('click', function(e) {
        e.preventDefault();
        
        // Hide all tabs
        resultTabs.querySelectorAll('a').forEach(tab => {
          tab.classList.remove('border-brand-purple', 'text-brand-purple');
          tab.classList.add('text-gray-500', 'hover:text-gray-700', 'border-transparent');
        });
        
        resultContent.querySelectorAll('.tab-pane').forEach(pane => {
          pane.style.display = 'none';
        });
        
        // Show active tab
        tabLink.classList.remove('text-gray-500', 'hover:text-gray-700', 'border-transparent');
        tabLink.classList.add('border-brand-purple', 'text-brand-purple');
        tabContent.style.display = 'block';
      });
      
      // If this is the first tab, show it
      if (result.stepNumber === 1) {
        tabLink.classList.remove('text-gray-500', 'hover:text-gray-700', 'border-transparent');
        tabLink.classList.add('border-brand-purple', 'text-brand-purple');
        tabContent.style.display = 'block';
      }
    }
    
    /**
     * Render analysis history in the UI.
     */
    function renderHistory() {
      if (!window.HistoryService) return;
      
      const history = window.HistoryService.getAnalysisHistory();
      const container = document.getElementById('analysisHistory');
      
      if (!container) return;
      
      container.innerHTML = '';
      
      if (history.length === 0) {
        container.innerHTML = "<p class='text-gray-500'>No previous analyses.</p>";
        return;
      }
      
      history.forEach((item, index) => {
        const date = new Date(item.timestamp).toLocaleString();
        const shortMsg = item.message.substring(0, 80).replace(/\n/g, " ");
        const div = document.createElement('div');
        div.className = 'border border-gray-200 rounded-md shadow-sm p-3 mb-3 history-item cursor-pointer hover:bg-gray-50 transition-all duration-200';
        div.dataset.index = index;
        
        div.innerHTML = `
          <div class="font-medium text-gray-800">${date}</div>
          <div class="text-gray-600 text-sm">${shortMsg}${shortMsg.length >= 80 ? '...' : ''}</div>
        `;
        
        div.addEventListener('click', () => {
          loadHistoryItem(index);
        });
        
        container.appendChild(div);
      });
    }
    
    /**
     * Load a history item back into the UI.
     */
    function loadHistoryItem(index) {
      if (!window.HistoryService || !window.StepService) return;
      
      const historyItem = window.HistoryService.getHistoryItem(index);
      if (!historyItem) return;
      
      // Clear current results
      clearResults();
      
      // Load steps
      window.StepService.getSteps().then(steps => {
        // Display each step result
        let stepNumber = 1;
        steps.forEach(step => {
          const output = historyItem.results[`${step.id}_output`] || "";
          const summary = historyItem.results[`${step.id}_summary`] || "";
          
          displayResult({
            stepId: step.id,
            menuName: step.menuName,
            output,
            summary,
            stepNumber,
            totalSteps: steps.length
          });
          
          stepNumber++;
        });
        
        // Show export button
        const exportContainer = document.getElementById('exportContainer');
        if (exportContainer) {
          exportContainer.classList.remove('hidden');
        }
      });
    }
    
    /**
     * Export current analysis as PDF using PdfService.
     */
    function exportAnalysisAsPdf() {
      if (window.PdfService) {
        window.PdfService.generatePDF();
        if (window.NotificationService) {
          window.NotificationService.success("Analysis exported as PDF");
        }
      } else {
        console.error("PdfService not available");
        if (window.NotificationService) {
          window.NotificationService.error("PDF service not available");
        }
      }
    }
    
    /**
     * Show spinner and set message
     */
    function showSpinner(message) {
      const spinnerContainer = document.getElementById('spinner-container');
      const spinnerMessage = document.getElementById('spinner-message');
      
      if (!spinnerContainer || !spinnerMessage) return;
      
      spinnerMessage.textContent = message || "Processing...";
      spinnerContainer.classList.remove('hidden');
    }
    
    /**
     * Hide spinner
     */
    function hideSpinner() {
      const spinnerContainer = document.getElementById('spinner-container');
      if (!spinnerContainer) return;
      
      spinnerContainer.classList.add('hidden');
    }
    
    /**
     * Update the progress bar
     */
    function updateProgressBar(current, total) {
      const progressBar = document.getElementById('progress-bar');
      if (!progressBar) return;
      
      const pct = Math.round((current / total) * 100);
      progressBar.style.width = pct + "%";
      progressBar.textContent = pct + "%";
    }
    
    // Register module with ModuleManager
    if (window.ModuleManager) {
      window.ModuleManager.registerModule({
        id: 'analysis',
        name: 'Analysis',
        template: 'modules/analysis/analysis.html',
        css: 'modules/analysis/analysis.css',
        init,
        mount,
        unmount,
        // Expose startAnalysis if you want to call it directly
        startAnalysis 
      });
    }
    
    // Return public API
    return {
      init,
      mount,
      unmount,
      startAnalysis
    };
})();
