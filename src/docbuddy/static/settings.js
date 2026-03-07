// DocBuddy Settings Panel — LLM configuration, theme, and tool calling settings
// Depends on: core.js (window.DocBuddy)

(function () {
  "use strict";

  var DB = window.DocBuddy;

  // ── LLMSettingsPanel component ───────────────────────────────────────────────
  function LLMSettingsPanelFactory(system) {
    var React = system.React;

    return class LLMSettingsPanel extends React.Component {
      constructor(props) {
        super(props);
        var s = DB.loadFromStorage();
        var ts = DB.loadToolSettings();
        this.state = {
          baseUrl: s.baseUrl || DB.DEFAULT_STATE.baseUrl,
          apiKey: s.apiKey || DB.DEFAULT_STATE.apiKey,
          modelId: s.modelId || DB.DEFAULT_STATE.modelId,
          maxTokens: s.maxTokens != null && s.maxTokens !== '' ? s.maxTokens : DB.DEFAULT_STATE.maxTokens,
          temperature: s.temperature != null && s.temperature !== '' ? s.temperature : DB.DEFAULT_STATE.temperature,
          provider: s.provider || DB.DEFAULT_STATE.provider,
          theme: DB.DEFAULT_STATE.theme,
          customColors: DB.DEFAULT_STATE.customColors,
          connectionStatus: "disconnected",
          lastError: "",
          availableModels: [],
          enableTools: ts.enableTools || false,
          autoExecute: ts.autoExecute || false,
          toolApiKey: ts.apiKey || '',
        };
        this._debouncedSave = DB.debounce(this._saveSettings.bind(this), 300);
        this.handleProviderChange = this.handleProviderChange.bind(this);
        this.handleBaseUrlChange = this.handleBaseUrlChange.bind(this);
        this.handleApiKeyChange = this.handleApiKeyChange.bind(this);
        this.handleModelIdChange = this.handleModelIdChange.bind(this);
        this.handleMaxTokensChange = this.handleMaxTokensChange.bind(this);
        this.handleTemperatureChange = this.handleTemperatureChange.bind(this);
        this.handleThemeChange = this.handleThemeChange.bind(this);
        this.handleEnableToolsChange = this.handleEnableToolsChange.bind(this);
        this.handleAutoExecuteChange = this.handleAutoExecuteChange.bind(this);
        this.handleToolApiKeyChange = this.handleToolApiKeyChange.bind(this);
        this.handleTestConnection = this.handleTestConnection.bind(this);
      }

      _saveSettings() {
        var settings = {
          baseUrl: this.state.baseUrl,
          apiKey: this.state.apiKey,
          modelId: this.state.modelId,
          maxTokens: this.state.maxTokens !== '' ? this.state.maxTokens : null,
          temperature: this.state.temperature !== '' ? this.state.temperature : null,
          provider: this.state.provider,
        };
        DB.saveToStorage(settings);
        DB.saveToolSettings({
          enableTools: this.state.enableTools,
          autoExecute: this.state.autoExecute,
          apiKey: this.state.toolApiKey,
        });
        DB.saveTheme({ theme: this.state.theme, customColors: this.state.customColors });
      }

      componentDidMount() {
        // Theme is already applied globally by core.js DOMContentLoaded handler.
        // Only sync local state from storage for the settings form.
        var stored = DB.loadTheme();
        this.setState({
          theme: stored.theme || DB.DEFAULT_STATE.theme,
          customColors: stored.customColors || {}
        });
      }

      componentDidUpdate(prevProps, prevState) {
        if (prevState.theme !== this.state.theme || prevState.customColors !== this.state.customColors) {
          window.applyLLMTheme(this.state.theme, this.state.customColors);
        }
      }

      handleTestConnection() {
        var self = this;
        var settings = {
          baseUrl: this.state.baseUrl,
          apiKey: this.state.apiKey,
          modelId: this.state.modelId,
        };
        DB.saveToStorage(Object.assign({}, DB.loadFromStorage(), settings));
        self.setState({ connectionStatus: "connecting", lastError: "" });
        DB.dispatchAction(system, 'setConnectionStatus', "connecting");

        var headers = { "Content-Type": "application/json" };
        if (settings.apiKey) {
          headers["Authorization"] = "Bearer " + settings.apiKey;
        }

        var baseUrl = (settings.baseUrl || "").replace(/\/+$/, "");

        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, 10000);

        fetch(baseUrl + "/models", {
          method: 'GET',
          headers: headers,
          signal: controller.signal
        })
          .then(function (res) {
            if (!res.ok) {
              return res.text().then(function(text) {
                throw new Error('HTTP ' + res.status + ': ' + res.statusText + (text ? " - " + text : ""));
              });
            }
            return res.json();
          })
          .then(function (data) {
            clearTimeout(timeoutId);
            if (data && data.error) {
              throw new Error(data.details || data.error);
            }
            var models = [];
            if (data && Array.isArray(data.data)) {
              models = data.data
                .map(function(m) { return m.id || m.name || ''; })
                .filter(function(id) { return id !== ''; })
                .sort();
            }
            var newState = { connectionStatus: "connected", availableModels: models };
            if (models.length > 0 && models.indexOf(self.state.modelId) === -1) {
              newState.modelId = models[0];
              DB.dispatchAction(system, 'setModelId', models[0]);
            }
            self.setState(newState);
            DB.saveToStorage(Object.assign({}, DB.loadFromStorage(), {
              baseUrl: self.state.baseUrl,
              apiKey: self.state.apiKey,
              modelId: newState.modelId || self.state.modelId,
            }));
            DB.dispatchAction(system, 'setConnectionStatus', "connected");
          })
          .catch(function (err) {
            clearTimeout(timeoutId);
            var errorMsg = err.name === 'AbortError' ? 'Connection timed out (10s)' : (err.message || "Connection failed");
            self.setState({ connectionStatus: "error", lastError: errorMsg });
            DB.dispatchAction(system, 'setConnectionStatus', "error");
          });
      }

      handleProviderChange(e) {
        var value = e.target.value;
        var provider = DB.LLM_PROVIDERS[value] || DB.LLM_PROVIDERS.custom;
        this.setState({ provider: value, baseUrl: provider.url, availableModels: [], connectionStatus: "disconnected" });
        DB.dispatchAction(system, 'setProvider', value);
        this._debouncedSave();
      }

      handleBaseUrlChange(e) {
        this.setState({ baseUrl: e.target.value });
        DB.dispatchAction(system, 'setBaseUrl', e.target.value);
        this._debouncedSave();
      }

      handleApiKeyChange(e) {
        this.setState({ apiKey: e.target.value });
        DB.dispatchAction(system, 'setApiKey', e.target.value);
        this._debouncedSave();
      }

      handleModelIdChange(e) {
        this.setState({ modelId: e.target.value });
        DB.dispatchAction(system, 'setModelId', e.target.value);
        this._debouncedSave();
      }

      handleMaxTokensChange(e) {
        this.setState({ maxTokens: e.target.value });
        DB.dispatchAction(system, 'setMaxTokens', e.target.value);
        this._debouncedSave();
      }

      handleTemperatureChange(e) {
        this.setState({ temperature: e.target.value });
        DB.dispatchAction(system, 'setTemperature', e.target.value);
        this._debouncedSave();
      }

      handleThemeChange(e) {
        var value = e.target.value;
        this.setState({ theme: value });
        DB.dispatchAction(system, 'setTheme', value);
        this._debouncedSave();
      }

      handleColorChange(colorKey, e) {
        var value = e.target.value;
        this.setState(function (prev) {
          var newColors = Object.assign({}, prev.customColors || {});
          newColors[colorKey] = value;
          return { customColors: newColors };
        });
        DB.dispatchAction(system, 'setCustomColor', { key: colorKey, value: value });
        this._debouncedSave();
      }

      handleEnableToolsChange(e) {
        this.setState({ enableTools: e.target.checked });
        this._debouncedSave();
      }

      handleAutoExecuteChange(e) {
        this.setState({ autoExecute: e.target.checked });
        this._debouncedSave();
      }

      handleToolApiKeyChange(e) {
        this.setState({ toolApiKey: e.target.value });
        this._debouncedSave();
      }

      render() {
        var self = this;
        var s = this.state;
        var React = system.React;

        var statusEmoji = DB.STATUS_EMOJI[s.connectionStatus] || "⚪";
        var provider = DB.LLM_PROVIDERS[s.provider] || DB.LLM_PROVIDERS.custom;

        var inputStyle = {
          background: "var(--theme-input-bg)",
          border: "1px solid var(--theme-border-color)",
          borderRadius: "4px",
          color: "var(--theme-text-primary)",
          padding: "6px 10px",
          width: "100%",
          boxSizing: "border-box",
          fontSize: "13px",
        };

        var labelStyle = { color: "var(--theme-text-secondary)", fontSize: "12px", marginBottom: "4px", display: "block" };
        var fieldStyle = { marginBottom: "12px" };

        var providerOptions = Object.keys(DB.LLM_PROVIDERS).map(function (key) {
          return React.createElement(
            "option",
            { key: key, value: key },
            DB.LLM_PROVIDERS[key].name
          );
        });

        var providerField = React.createElement(
          "div",
          { style: fieldStyle },
          React.createElement("label", { style: labelStyle }, "LLM Provider"),
          React.createElement(
            "select",
            {
              value: s.provider,
              onChange: this.handleProviderChange,
              style: inputStyle
            },
            providerOptions
          )
        );

        var baseUrlField = React.createElement(
          "div",
          { style: fieldStyle },
          React.createElement("label", { style: labelStyle }, "Base URL"),
          React.createElement("input", {
            type: "text",
            value: s.baseUrl,
            style: inputStyle,
            onChange: this.handleBaseUrlChange,
          })
        );

        var fields = React.createElement(
          "div",
          { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px 20px" } },
          providerField,
          baseUrlField,
          React.createElement(
            "div",
            { style: fieldStyle },
            React.createElement("label", { style: labelStyle }, "API Key"),
            React.createElement("input", {
              type: "password",
              value: s.apiKey,
              placeholder: "sk-...",
              style: inputStyle,
              onChange: this.handleApiKeyChange,
            })
          ),
          React.createElement(
            "div",
            { style: fieldStyle },
            React.createElement("label", { style: labelStyle }, "Model ID"),
            s.availableModels.length > 0
              ? React.createElement(
                  "select",
                  {
                    value: s.modelId,
                    style: inputStyle,
                    onChange: this.handleModelIdChange,
                  },
                  s.availableModels.map(function (model) {
                    return React.createElement("option", { key: model, value: model }, model);
                  })
                )
              : React.createElement("input", {
                  type: "text",
                  value: s.modelId,
                  style: inputStyle,
                  onChange: this.handleModelIdChange,
                })
          ),
          React.createElement(
            "div",
            { style: fieldStyle },
            React.createElement("label", { style: labelStyle }, "Max Tokens"),
            React.createElement("input", {
              type: "number",
              value: s.maxTokens !== '' ? s.maxTokens : "",
              min: 1,
              placeholder: "4096",
              style: inputStyle,
              onChange: this.handleMaxTokensChange,
            })
          ),
          React.createElement(
            "div",
            { style: fieldStyle },
            React.createElement("label", { style: labelStyle }, "Temperature (0 – 2)"),
            React.createElement("input", {
              type: "number",
              value: s.temperature !== '' ? s.temperature : "",
              min: 0,
              max: 2,
              step: 0.1,
              placeholder: "0.7",
              style: inputStyle,
              onChange: this.handleTemperatureChange,
            })
          )
        );

        var themeConfig = React.createElement(
          "div",
          { style: fieldStyle },
          React.createElement("label", { style: labelStyle }, "Theme"),
          React.createElement(
            "select",
            {
              value: s.theme,
              onChange: this.handleThemeChange,
              style: inputStyle
            },
            Object.keys(DB.THEME_DEFINITIONS).map(function (key) {
              return React.createElement(
                "option",
                { key: key, value: key },
                DB.THEME_DEFINITIONS[key].name
              );
            })
          )
        );

        var colorFields = React.createElement(
          "div",
          { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))", gap: "12px" } },
          React.createElement(
            "div",
            { style: fieldStyle },
            React.createElement("label", { style: labelStyle }, "Primary"),
            React.createElement("input", {
              type: "color",
              value: s.customColors.primary || DB.THEME_DEFINITIONS[s.theme].primary,
              onChange: this.handleColorChange.bind(this, 'primary'),
              style: { width: "60px", height: "32px", border: "none", cursor: "pointer" }
            })
          ),
          React.createElement(
            "div",
            { style: fieldStyle },
            React.createElement("label", { style: labelStyle }, "Background"),
            React.createElement("input", {
              type: "color",
              value: s.customColors.background || DB.THEME_DEFINITIONS[s.theme].background,
              onChange: this.handleColorChange.bind(this, 'background'),
              style: { width: "60px", height: "32px", border: "none", cursor: "pointer" }
            })
          ),
          React.createElement(
            "div",
            { style: fieldStyle },
            React.createElement("label", { style: labelStyle }, "Text Primary"),
            React.createElement("input", {
              type: "color",
              value: s.customColors.textPrimary || DB.THEME_DEFINITIONS[s.theme].textPrimary,
              onChange: this.handleColorChange.bind(this, 'textPrimary'),
              style: { width: "60px", height: "32px", border: "none", cursor: "pointer" }
            })
          )
        );

        var checkboxStyle = { marginRight: "8px", cursor: "pointer" };
        var checkboxLabelStyle = { color: "var(--theme-text-primary)", fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center" };
        var toolCallSettings = React.createElement(
          "div",
          { style: { marginBottom: "24px", paddingBottom: "20px", borderBottom: "1px solid var(--theme-border-color)" } },
          React.createElement("h3", { style: { color: "var(--theme-text-primary)", fontSize: "14px", fontWeight: "600", marginBottom: "12px" } }, "Tool Calling (API Execution)"),
          React.createElement(
            "div",
            { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px 20px", alignItems: "start" } },
            React.createElement(
              "div",
              { style: fieldStyle },
              React.createElement(
                "label",
                { style: checkboxLabelStyle },
                React.createElement("input", {
                  type: "checkbox",
                  checked: s.enableTools,
                  onChange: this.handleEnableToolsChange,
                  style: checkboxStyle
                }),
                "Enable API Tool Calling"
              ),
              React.createElement("div", { style: { color: "var(--theme-text-secondary)", fontSize: "11px", marginTop: "4px" } },
                "Allow the LLM to execute API calls"
              )
            ),
            React.createElement(
              "div",
              { style: fieldStyle },
              React.createElement(
                "label",
                { style: checkboxLabelStyle },
                React.createElement("input", {
                  type: "checkbox",
                  checked: s.autoExecute,
                  onChange: this.handleAutoExecuteChange,
                  style: checkboxStyle,
                  disabled: !s.enableTools
                }),
                "Auto-Execute"
              ),
              React.createElement("div", { style: { color: "var(--theme-text-secondary)", fontSize: "11px", marginTop: "4px" } },
                "Execute tool calls without confirmation"
              )
            ),
            React.createElement(
              "div",
              { style: fieldStyle },
              React.createElement("label", { style: labelStyle }, "API Key for Tool Calls"),
              React.createElement("input", {
                type: "password",
                value: s.toolApiKey,
                placeholder: "Bearer token for target API",
                style: inputStyle,
                disabled: !s.enableTools,
                onChange: this.handleToolApiKeyChange
              })
            )
          )
        );

        var testButton = React.createElement(
          "button",
          {
            onClick: this.handleTestConnection,
            style: {
              background: "var(--theme-accent)",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              padding: "8px 18px",
              cursor: "pointer",
              fontSize: "13px",
            },
          },
          "Test Connection"
        );

        var statusBadge = React.createElement(
          "span",
          {
            style: {
              marginLeft: "12px",
              fontSize: "13px",
              color: s.connectionStatus === "error" ? "#f87171" : "var(--theme-text-secondary)",
              verticalAlign: "middle",
            },
          },
          React.createElement(
            "span",
            { style: { marginRight: "4px" } },
            statusEmoji
          ),
          s.connectionStatus === "error"
            ? React.createElement(
                "span",
                { title: s.lastError, style: { cursor: "help", borderBottom: "1px dashed #f87171" } },
                s.lastError || "Connection failed"
              )
            : s.connectionStatus
        );

        var systemPromptPresetSelector = DB.createSystemPromptPresetSelector(React);

        var bodyContent = React.createElement(
          "div",
          { style: { padding: "16px", background: "var(--theme-panel-bg)" } },
          React.createElement(
            "div",
            { style: { marginBottom: "24px", paddingBottom: "20px", borderBottom: "1px solid var(--theme-border-color)" } },
            React.createElement("h3", { style: { color: "var(--theme-text-primary)", fontSize: "14px", fontWeight: "600", marginBottom: "12px" } }, "LLM Configuration"),
            React.createElement("div", { style: { display: "flex", alignItems: "center", marginBottom: "16px" } },
              testButton,
              React.createElement("div", { style: { flex: 1 } }),
              statusBadge
            ),
            fields
          ),
          React.createElement(
            "div",
            { style: { marginBottom: "24px", paddingBottom: "20px", borderBottom: "1px solid var(--theme-border-color)" } },
            React.createElement("h3", { style: { color: "var(--theme-text-primary)", fontSize: "14px", fontWeight: "600", marginBottom: "12px" } }, "System Prompt Preset"),
            React.createElement("p", { style: { color: "var(--theme-text-secondary)", fontSize: "12px", marginBottom: "12px" } },
              "Select a preset system prompt that defines the assistant's behavior. The 'API Assistant' preset is optimized for REST API documentation."
            ),
          React.createElement(systemPromptPresetSelector, {
            value: s.systemPromptPreset || 'api_assistant',
            onChange: (function(val) {
              self.setState({ systemPromptPreset: val });
              var stored = DB.loadFromStorage();
              stored.systemPromptPreset = val;
              DB.saveToStorage(stored);
            }),
            customPrompt: s.customSystemPrompt || '',
            onCustomChange: (function(val) {
              self.setState({ customSystemPrompt: val });
              var stored = DB.loadFromStorage();
              stored.customSystemPrompt = val;
              DB.saveToStorage(stored);
            }),
            labelStyle: Object.assign({}, labelStyle, { color: "var(--theme-text-primary)" }),
            inputStyle: Object.assign({}, inputStyle, { marginBottom: '8px', fontSize: '12px' })
          })
          ),
          React.createElement(
            "div",
            { style: { marginBottom: "24px", paddingBottom: "20px", borderBottom: "1px solid var(--theme-border-color)" } },
            React.createElement("h3", { style: { color: "var(--theme-text-primary)", fontSize: "14px", fontWeight: "600", marginBottom: "12px" } }, "Theme Settings"),
            React.createElement(
              "div",
              { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "12px" } },
              themeConfig,
              React.createElement(
                "div",
                null,
                colorFields
              )
            )
          ),
          toolCallSettings
        );

        // Version footer with link to GitHub repo
        var versionFooter = React.createElement(
          "div",
          {
            style: {
              marginTop: "24px",
              paddingTop: "16px",
              borderTop: "1px solid var(--theme-border-color)",
              textAlign: "center",
            },
          },
          React.createElement(
            "a",
            {
              href: "https://github.com/pearsonkyle/docbuddy",
              target: "_blank",
              rel: "noopener noreferrer",
              style: {
                color: "var(--theme-text-secondary)",
                fontSize: "12px",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              },
            },
            React.createElement("span", null, "docbuddy v"),
            React.createElement(
              "span",
              {
                style: {
                  color: "var(--theme-text-primary)",
                  fontWeight: "500",
                },
              },
              window.DOCBUDDY_VERSION || "unknown"
            ),
            React.createElement("span", null, " • "),
            React.createElement(
              "span",
              { style: { color: "var(--theme-primary)" } },
              "View on GitHub →"
            )
          )
        );

        return React.createElement(
          "div",
          {
            id: "llm-settings-panel",
            style: {
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
              minHeight: "400px",
            },
          },
          bodyContent,
          versionFooter
        );
      }
    };
  }

  DB.LLMSettingsPanelFactory = LLMSettingsPanelFactory;

})();
