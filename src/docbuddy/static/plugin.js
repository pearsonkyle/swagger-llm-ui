// DocBuddy Plugin — assembles the Swagger UI plugin from the DocBuddy namespace.
// Combines state management, component factories, and the tab layout.
// Load order: core.js -> chat.js, settings.js, workflow.js -> plugin.js

(function () {
  "use strict";

  var DB = window.DocBuddy;

  // Storage key for persisting active tab
  var TAB_STORAGE_KEY = "docbuddy-active-tab";

  // Inject pulse animation keyframe for streaming indicator
  (function () {
    var style = document.createElement("style");
    style.textContent = "@keyframes docbuddy-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }";
    document.head.appendChild(style);
  })();

  window.DocBuddyPlugin = function (system) {
    var React = system.React;

    // Error boundary to catch render errors in panels
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error: error };
      }
      componentDidCatch(error, info) {
        console.error('DocBuddy Error:', error, info);
      }
      render() {
        if (this.state.hasError) {
          return React.createElement('div', {
            style: { padding: '20px', color: '#ef4444', textAlign: 'center', fontFamily: "'Inter', sans-serif" }
          }, 'Something went wrong. Please reload the page.');
        }
        return this.props.children;
      }
    }

    function LLMDocsLayout(props) {
      var BaseLayout = system.getComponent("BaseLayout", true);
      var LLMSettingsPanel = system.getComponent("LLMSettingsPanel", true);
      var ChatPanel = system.getComponent("ChatPanel", true);
      var WorkflowPanel = system.getComponent("WorkflowPanel", true);
      var AgentPanel = system.getComponent("AgentPanel", true);

      // Get saved tab preference, default to "api"
      var savedTab = localStorage.getItem(TAB_STORAGE_KEY) || "api";
      var _state = React.useState(savedTab);
      var activeTab = _state[0];
      var setActiveTab = _state[1];

      // Listen for external tab change requests (from other plugins)
      React.useEffect(function () {
        var handleStorageChange = function(e) {
          if (e.key === TAB_STORAGE_KEY && e.newValue) {
            setActiveTab(e.newValue);
          }
        };

        window.addEventListener('storage', handleStorageChange);
        return function() {
          window.removeEventListener('storage', handleStorageChange);
        };
      }, []);

      // Expose direct tab-switch function for same-page use
      window.llmSwitchTab = function(tab) { setActiveTab(tab); };

      // Persist tab preference to localStorage
      React.useEffect(function () {
        localStorage.setItem(TAB_STORAGE_KEY, activeTab);
      }, [activeTab]);

      // When switching back to chat or agent, scroll to bottom to show any messages streamed in background
      React.useEffect(function () {
        requestAnimationFrame(function () {
          if (activeTab === "chat") {
            var chatEl = document.getElementById('llm-chat-messages');
            if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
          } else if (activeTab === "agent") {
            var agentEl = document.getElementById('llm-agent-messages');
            if (agentEl) agentEl.scrollTop = agentEl.scrollHeight;
          }
        });
      }, [activeTab]);

      // Track whether chat is actively streaming (for tab indicator)
      var _streamState = React.useState(false);
      var chatStreaming = _streamState[0];
      var setChatStreaming = _streamState[1];

      React.useEffect(function () {
        var handler = function (e) {
          setChatStreaming(e.detail && e.detail.streaming);
        };
        window.addEventListener('docbuddy-chat-streaming', handler);
        return function () {
          window.removeEventListener('docbuddy-chat-streaming', handler);
        };
      }, []);

      // Track whether workflow is actively streaming (for tab indicator)
      var _workflowStreamState = React.useState(false);
      var workflowStreaming = _workflowStreamState[0];
      var setWorkflowStreaming = _workflowStreamState[1];

      React.useEffect(function () {
        var handler = function (e) {
          setWorkflowStreaming(e.detail && e.detail.streaming);
        };
        window.addEventListener('docbuddy-workflow-streaming', handler);
        return function () {
          window.removeEventListener('docbuddy-workflow-streaming', handler);
        };
      }, []);

      // Track whether agent is actively streaming (for tab indicator)
      var _agentStreamState = React.useState(false);
      var agentStreaming = _agentStreamState[0];
      var setAgentStreaming = _agentStreamState[1];

      React.useEffect(function () {
        var handler = function (e) {
          setAgentStreaming(e.detail && e.detail.streaming);
        };
        window.addEventListener('docbuddy-agent-streaming', handler);
        return function () {
          window.removeEventListener('docbuddy-agent-streaming', handler);
        };
      }, []);

      // Tab styles for 3 tabs (theme-aware)
      var tabStyle = function (tab) {
        return {
          background: activeTab === tab ? "var(--theme-primary)" : "var(--theme-secondary)",
          color: activeTab === tab ? "#fff" : "var(--theme-text-secondary)",
          border: "none",
          borderRadius: "4px 4px 0 0",
          padding: "8px 16px",
          cursor: "pointer",
          fontSize: "12px",
          fontWeight: activeTab === tab ? "600" : "400",
        };
      };

      // Content area style - full height for chat, settings, workflow, and agent
      var isContained = activeTab === "chat" || activeTab === "settings" || activeTab === "workflow" || activeTab === "agent";
      var contentStyle = {
        border: "1px solid var(--theme-border-color)",
        borderTop: "none",
        borderRadius: "0 0 6px 6px",
        background: "var(--theme-header-bg)",
        height: isContained ? "calc(100vh - 120px)" : "auto",
        minHeight: isContained ? "400px" : "auto",
        overflow: isContained ? (activeTab === "chat" || activeTab === "agent" ? "hidden" : "auto") : "auto",
        flex: isContained ? "none" : "1 1 auto",
        overscrollBehavior: isContained ? "contain" : "auto",
        WebkitOverflowScrolling: "touch",
      };

      return React.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", height: isContained ? "100%" : "auto" } },
        // Tab navigation bar
        React.createElement(
          "div",
          {
            style: {
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
              border: "1px solid var(--theme-border-color)",
              borderRadius: "6px 6px 0 0",
              background: "var(--theme-header-bg)",
              flexShrink: 0,
            }
          },
          React.createElement(
            "div",
            { role: "tablist", "aria-label": "Documentation tabs", style: { display: "flex", gap: "2px", padding: "8px 8px 0 8px" } },
            // API tab
            React.createElement(
              "button",
              { role: "tab", "aria-selected": activeTab === "api", onClick: function () { setActiveTab("api"); }, style: tabStyle("api") },
              "API"
            ),
            // Chat tab
            React.createElement(
              "button",
              { role: "tab", "aria-selected": activeTab === "chat", onClick: function () { setActiveTab("chat"); }, style: tabStyle("chat") },
              "Chat",
              chatStreaming && activeTab !== "chat"
                ? React.createElement("span", {
                    style: {
                      display: "inline-block",
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#10b981",
                      marginLeft: "6px",
                      animation: "docbuddy-pulse 1.4s infinite ease-in-out",
                      verticalAlign: "middle"
                    },
                    title: "Streaming in progress"
                  })
                : null
            ),
            // Workflow tab
            React.createElement(
              "button",
              { role: "tab", "aria-selected": activeTab === "workflow", onClick: function () { setActiveTab("workflow"); }, style: tabStyle("workflow") },
              "Workflow",
              workflowStreaming && activeTab !== "workflow"
                ? React.createElement("span", {
                    style: {
                      display: "inline-block",
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#10b981",
                      marginLeft: "6px",
                      animation: "docbuddy-pulse 1.4s infinite ease-in-out",
                      verticalAlign: "middle"
                    },
                    title: "Streaming in progress"
                  })
                : null
            ),
            // Agent tab
            React.createElement(
              "button",
              { role: "tab", "aria-selected": activeTab === "agent", onClick: function () { setActiveTab("agent"); }, style: tabStyle("agent") },
              "Agent",
              agentStreaming && activeTab !== "agent"
                ? React.createElement("span", {
                    style: {
                      display: "inline-block",
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#f59e0b",
                      marginLeft: "6px",
                      animation: "docbuddy-pulse 1.4s infinite ease-in-out",
                      verticalAlign: "middle"
                    },
                    title: "Agent streaming in progress"
                  })
                : null
            ),
            // Settings tab
            React.createElement(
              "button",
              { role: "tab", "aria-selected": activeTab === "settings", onClick: function () { setActiveTab("settings"); }, style: tabStyle("settings") },
              "Settings"
            )
          )
        ),

        // Content area - use dynamic contentStyle for proper chat height
        React.createElement(
          "div",
          { role: "tabpanel", style: contentStyle },
          // API api tab content
          activeTab === "api" ? React.createElement(BaseLayout, props) : null,

          // Chat tab content (always mounted, hidden via CSS to preserve streaming state across tab switches)
          React.createElement("div", { style: { display: activeTab === "chat" ? "block" : "none", height: "100%" } },
            React.createElement(ErrorBoundary, null, React.createElement(ChatPanel, null))
          ),

          // Workflow tab content (always mounted, hidden via CSS to preserve streaming state across tab switches)
          React.createElement("div", { style: { display: activeTab === "workflow" ? "block" : "none", height: "100%" } },
            React.createElement(ErrorBoundary, null, React.createElement(WorkflowPanel, null))
          ),

          // Agent tab content (always mounted, hidden via CSS to preserve streaming state across tab switches)
          React.createElement("div", { style: { display: activeTab === "agent" ? "block" : "none", height: "100%" } },
            React.createElement(ErrorBoundary, null, React.createElement(AgentPanel, null))
          ),

          // LLM Settings tab content (always mounted, hidden via CSS to preserve state across tab switches)
          React.createElement("div", { style: { display: activeTab === "settings" ? "block" : "none", height: "100%", overflow: "auto" } },
            React.createElement(ErrorBoundary, null, React.createElement(LLMSettingsPanel, null))
          )
        )
      );
    }

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
        AgentPanel: DB.AgentPanelFactory(system),
        LLMDocsLayout: LLMDocsLayout,
      },
    };
  };
})();
