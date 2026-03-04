// DocBuddy Plugin Assembly
// Assembles the Swagger UI plugin from the DocBuddy namespace components.
// Load order: docbuddy-core.js -> docbuddy-chat.js, docbuddy-settings.js,
//             docbuddy-workflow.js -> docbuddy-plugin.js -> llm-layout-plugin.js

(function () {
  "use strict";

  var DB = window.DocBuddy;

  window.LLMSettingsPlugin = function (system) {
    return {
      statePlugins: {
        llmSettings: {
          actions: DB.actions,
          reducers: { llmSettings: DB.llmSettingsReducer },
          selectors: DB.selectors,
        },
      },
      components: {
        LLMSettingsPanel: DB.LLMSettingsPanelFactory(system),
        ChatPanel: DB.ChatPanelFactory(system),
        WorkflowPanel: DB.WorkflowPanelFactory(system),
      },
    };
  };
})();
