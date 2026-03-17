// DocBuddy Chat Panel — Chat interface with SSE streaming and tool calling
// Depends on: core.js (window.DocBuddy)

(function () {
  "use strict";

  var DB = window.DocBuddy;

  // ── Chat panel component ───────────────────────────────────────────────────
  function ChatPanelFactory(system) {
    var React = system.React;
    var CodeBlock = DB.createCodeBlock(React);

    return class ChatPanel extends React.Component {
      constructor(props) {
        super(props);
        this.state = {
          input: "",
          isTyping: false,
          isProcessingToolCall: false,
          chatHistory: DB.loadChatHistory(),
          copiedId: null,
          pendingToolCall: null,
          editMethod: 'GET',
          editPath: '',
          editQueryParams: '{}',
          editPathParams: '{}',
          editBody: '{}',
          toolCallResponse: null,
          toolRetryCount: 0,
          selectedPreset: DB.loadFromStorage().systemPromptPreset || 'api_assistant',
          customSystemPrompt: DB.loadFromStorage().customSystemPrompt || '',
        };
        this.handleSend = this.handleSend.bind(this);
        this.handleInputChange = this.handleInputChange.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleCancel = this.handleCancel.bind(this);
        this.clearHistory = this.clearHistory.bind(this);
        this.handleBubbleClick = this.handleBubbleClick.bind(this);
        this.renderTypingIndicator = this.renderTypingIndicator.bind(this);
        this.formatMessageContent = this.formatMessageContent.bind(this);
        this.renderMessage = this.renderMessage.bind(this);
        this.handleExecuteToolCall = this.handleExecuteToolCall.bind(this);
        this.sendToolResult = this.sendToolResult.bind(this);
        this.renderToolCallPanel = this.renderToolCallPanel.bind(this);
        this._copyTimeoutId = null;
        this._debouncedSaveChatHistory = DB.debounce(function(history) {
          DB.saveChatHistory(history);
        }, 500);

        DB.initMarked();
      }

      componentDidMount() {
        this.fetchOpenApiSchema();
      }

      componentWillUnmount() {
        if (this._currentCancelToken) {
          this._currentCancelToken.abort();
          this._currentCancelToken = null;
        }
        if (this._copyTimeoutId) {
          clearTimeout(this._copyTimeoutId);
          this._copyTimeoutId = null;
        }
      }

      fetchOpenApiSchema() {
        var self = this;
        DB.ensureOpenapiSchemaCached(function(schema) {
          if (schema) {
            DB.dispatchAction(system, 'setOpenApiSchema', schema);
          }
        });
      }

      addMessage(msg) {
        this.setState(function (prev) {
          var history = prev.chatHistory || [];
          if (history.length > 0 && msg.role === 'assistant' && history[history.length - 1].role === 'assistant' && history[history.length - 1].messageId === msg.messageId) {
            var updated = history.slice(0, -1).concat([msg]);
            DB.saveChatHistory(updated);
            return { chatHistory: updated };
          }
          var updated = history.concat([msg]);
          DB.saveChatHistory(updated);
          return { chatHistory: updated };
        });
      }

      handleInputChange(e) {
        this.setState({ input: e.target.value });
      }

      handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSend();
        }
      }

      handleCancel() {
        if (this._currentCancelToken) {
          this._currentCancelToken.abort();
        }
      }

      handleExecuteToolCall() {
        var self = this;
        var s = this.state;

        var executedArgs = {
          method: s.editMethod || 'GET',
          path: s.editPath || '',
        };
        try { executedArgs.query_params = JSON.parse(s.editQueryParams || '{}'); } catch (e) { executedArgs.query_params = {}; }
        try { executedArgs.path_params = JSON.parse(s.editPathParams || '{}'); } catch (e) { executedArgs.path_params = {}; }
        if (s.editMethod === 'POST' || s.editMethod === 'PUT' || s.editMethod === 'PATCH') {
          try { executedArgs.body = JSON.parse(s.editBody || '{}'); } catch (e) { executedArgs.body = {}; }
        }

        if (self._pendingToolCallMsg) {
          var toolMsg = Object.assign({}, self._pendingToolCallMsg, {
            _displayContent: 'Tool call: api_request(' + executedArgs.method + ' ' + executedArgs.path + ')',
            _toolArgs: executedArgs
          });
          if (toolMsg.tool_calls && toolMsg.tool_calls.length > 0) {
            toolMsg.tool_calls = toolMsg.tool_calls.map(function(tc) {
              return Object.assign({}, tc, {
                function: Object.assign({}, tc.function, {
                  arguments: JSON.stringify(executedArgs)
                })
              });
            });
          }
          self.addMessage(toolMsg);
          self._pendingToolCallMsg = null;
        }

        var url = s.editPath;

        try { url = decodeURIComponent(url); } catch (e) {}
        if (!url || !/^\//.test(url)) {
          console.error('[Tool Call] Rejected invalid path:', url);
          var rejectObj = { status: 0, statusText: 'Blocked', body: 'Tool call path must be a relative URL starting with /' };
          self.setState({ toolCallResponse: rejectObj });
          self.sendToolResult(rejectObj);
          return;
        }

        try {
          var pathParams = JSON.parse(s.editPathParams || '{}');
          Object.keys(pathParams).forEach(function(key) {
            url = url.replace('{' + key + '}', encodeURIComponent(pathParams[key]));
          });
          // Re-validate after path params substitution to prevent bypass via path param values
          if (/\.\./.test(url)) {
            console.error('[Tool Call] Rejected path with ".." after param substitution:', url);
            var rejectObj = { status: 0, statusText: 'Blocked', body: 'Tool call path must not contain ".."' };
            self.setState({ toolCallResponse: rejectObj });
            self.sendToolResult(rejectObj);
            return;
          }
        } catch (e) { console.warn('Failed to apply path params:', e); }

        try {
          var queryParams = JSON.parse(s.editQueryParams || '{}');
          var queryKeys = Object.keys(queryParams);
          if (queryKeys.length > 0) {
            var qs = queryKeys.map(function(k) {
              return encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]);
            }).join('&');
            url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
          }
        } catch (e) { console.warn('Failed to parse query params:', e); }

        // Use the new resolveApiBaseUrl function which handles:
        // 1. User-configured API Base URL (highest priority)
        // 2. OpenAPI schema servers array
        // 3. Auto-detect from loaded schema URL
        // 4. Fallback to page origin (for local development)
        var apiBaseUrl = DB.resolveApiBaseUrl(DB._cachedOpenapiSchema);
        url = apiBaseUrl + url;

        var fetchHeaders = {};
        var toolSettings = DB.loadToolSettings();
        var toolApiKey = toolSettings.apiKey && typeof toolSettings.apiKey === 'string' ? toolSettings.apiKey.trim() : '';
        if (toolApiKey) {
          fetchHeaders['Authorization'] = 'Bearer ' + toolApiKey;
        }

        var hasBody = (s.editMethod === 'POST' || s.editMethod === 'PUT' || s.editMethod === 'PATCH') && s.editBody;
        if (hasBody) {
          fetchHeaders['Content-Type'] = 'application/json';
        }

        var fetchOpts = {
          method: s.editMethod,
          headers: fetchHeaders,
        };

        if (hasBody) {
          try {
            JSON.parse(s.editBody);
          } catch (e) {
            var parseErrObj = { status: 0, statusText: 'Invalid JSON', body: 'Request body is not valid JSON: ' + e.message };
            self.setState({ toolCallResponse: parseErrObj });
            self.sendToolResult(parseErrObj);
            return;
          }
          fetchOpts.body = s.editBody;
        }

        self.setState({ toolCallResponse: { status: 'loading', body: '' } });

        fetch(url, fetchOpts)
          .then(function(res) {
            return res.text().then(function(text) {
              var responseObj = { status: res.status, statusText: res.statusText, body: text };
              self.setState({ toolCallResponse: responseObj });
              self.sendToolResult(responseObj);
            });
          })
          .catch(function(err) {
            var responseObj = { status: 0, statusText: 'Network Error', body: err.message };
            console.error('[Tool Call Error]', err.message);
            self.setState({ toolCallResponse: responseObj });
            self.sendToolResult(responseObj);
          });
      }

      sendToolResult(responseObj) {
        var self = this;
        var s = this.state;

        if (s.toolRetryCount >= 3) {
          var lastError = 'Status ' + responseObj.status + ' ' + (responseObj.statusText || '');
          var lastBody = (responseObj.body || '').substring(0, 500);
          var errorDetail = lastError + (lastBody ? '\n\n```\n' + lastBody + '\n```' : '');
          console.error('[Tool Call] Max retries reached.');
          self.addMessage({
            role: 'assistant',
            content: 'Max tool call retries (3) reached. Last error: ' + errorDetail + '\n\nPlease try a different approach.',
            messageId: DB.generateMessageId()
          });
          self.setState({ pendingToolCall: null, isTyping: false });
          return;
        }

        var toolCallId = s.pendingToolCall ? s.pendingToolCall.id : 'call_unknown';

        var truncatedBody = (responseObj.body || '').substring(0, 4000);
        var resultContent = 'Status: ' + responseObj.status + ' ' + (responseObj.statusText || '') + '\n\n' + truncatedBody;

        var toolResultMsg = {
          role: 'tool',
          content: resultContent,
          tool_call_id: toolCallId,
          messageId: DB.generateMessageId(),
          _displayContent: 'Tool result: Status ' + responseObj.status
        };

        var currentHistory = (self.state.chatHistory || []).slice();
        currentHistory.push(toolResultMsg);

        var apiMessages = DB.buildApiMessages(currentHistory);

        self.addMessage(toolResultMsg);

        var streamMsgId = DB.generateMessageId();
        var isError = responseObj.status < 200 || responseObj.status >= 300;
        self.setState({
          pendingToolCall: null,
          toolRetryCount: isError ? s.toolRetryCount + 1 : 0,
        });

        self._streamLLMResponse(apiMessages, streamMsgId, DB._cachedOpenapiSchema);
      }

      _getErrorMessage(err, responseText) {
        var errorMsg = err.message || "Request failed";
        var details = "";

        try {
          if (responseText) {
            var parsed = JSON.parse(responseText);
            if (parsed.details) details = parsed.details;
            else if (parsed.error) details = parsed.error;
          }
        } catch (e) {
          if (responseText && responseText.length < 500) {
            details = responseText;
          }
        }

        var lowerError = (errorMsg + ' ' + details).toLowerCase();

        if (lowerError.includes('connection refused') ||
            lowerError.includes('connect timeout') ||
            lowerError.includes('network') ||
            lowerError.includes('econnrefused') ||
            lowerError.includes('enotfound') ||
            lowerError.includes('fetch failed')) {
          return {
            title: "Connection Failed",
            message: "Could not connect to your LLM provider. Please verify your Base URL in Settings.",
            action: "Check Settings",
            needsSettings: true
          };
        }

        if (lowerError.includes('401') ||
            lowerError.includes('403') ||
            lowerError.includes('unauthorized') ||
            lowerError.includes('invalid api key') ||
            lowerError.includes('authentication') ||
            lowerError.includes('api key')) {
          return {
            title: "Authentication Failed",
            message: "Your API key appears to be invalid or missing. Please check your API Key in Settings.",
            action: "Check Settings",
            needsSettings: true
          };
        }

        if (lowerError.includes('404') ||
            lowerError.includes('not found') ||
            lowerError.includes('model')) {
          return {
            title: "Resource Not Found",
            message: "The requested resource was not found. This might mean your Model ID is incorrect or the endpoint doesn't exist.",
            action: "Check Settings",
            needsSettings: true
          };
        }

        if (lowerError.includes('429') ||
            lowerError.includes('rate limit') ||
            lowerError.includes('too many requests')) {
          return {
            title: "Rate Limited",
            message: "You've sent too many requests. Please wait a moment and try again.",
            action: null,
            needsSettings: false
          };
        }

        if (lowerError.includes('timeout') ||
            lowerError.includes('timed out')) {
          return {
            title: "Request Timeout",
            message: "The request took too long. The LLM provider may be busy or experiencing issues.",
            action: null,
            needsSettings: false
          };
        }

        if (lowerError.includes('500') ||
            lowerError.includes('502') ||
            lowerError.includes('503') ||
            lowerError.includes('504') ||
            lowerError.includes('server error')) {
          return {
            title: "Server Error",
            message: "The LLM provider's server encountered an error. This is usually a temporary issue.",
            action: null,
            needsSettings: false
          };
        }

        return {
          title: "Request Failed",
          message: details || errorMsg,
          action: "Check Settings",
          needsSettings: true
        };
      }

      _renderErrorInChat(errorInfo) {
        var React = system.React;
        var children = [
          React.createElement("div", { className: "llm-error-title" }, errorInfo.title),
          React.createElement("div", { className: "llm-error-text" }, errorInfo.message)
        ];

        if (errorInfo.needsSettings) {
          children.push(
            React.createElement("div", { className: "llm-error-actions" },
              React.createElement("button", {
                className: "llm-error-action-btn",
                onClick: function() { window.llmOpenSettings && window.llmOpenSettings(); }
              }, "\u2699\uFE0F " + errorInfo.action)
            )
          );
        }

        return React.createElement("div", { className: "llm-error-message" }, children);
      }

      _streamLLMResponse(apiMessages, streamMsgId, fullSchema) {
        var self = this;
        var settings = DB.loadFromStorage();
        var toolSettings = DB.loadToolSettings();

        var selectedPreset = this.state.selectedPreset || 'api_assistant';
        var customPromptText = selectedPreset === 'custom' ? (this.state.customSystemPrompt || '') : '';

        // Ensure both system prompt config and OpenAPI schema are loaded before building the prompt
        var configReady = DB.ensureSystemPromptConfig();
        var schemaReady = new Promise(function(resolve) {
          DB.ensureOpenapiSchemaCached(function() { resolve(); });
        });

        Promise.all([configReady, schemaReady]).then(function() {
          // Re-read schema from cache (it may have loaded after handleSend captured null)
          var schema = DB._cachedOpenapiSchema || fullSchema;
          self._streamWithPrompt(apiMessages, streamMsgId, schema, settings, toolSettings, selectedPreset, customPromptText);
        });
      }

      _streamWithPrompt(apiMessages, streamMsgId, fullSchema, settings, toolSettings, selectedPreset, customPromptText) {
        var self = this;

        var systemPrompt = DB.getSystemPromptForPreset(selectedPreset, fullSchema, customPromptText);

        if (toolSettings.enableTools) {
          systemPrompt = systemPrompt.replace(/## Tool Calling Instructions[\s\S]*$/, '').trimEnd();
          systemPrompt += "\n\nUse the `api_request` tool via native tool calling when the user asks to call an API endpoint. Do NOT output tool calls as JSON text — the system handles tool execution automatically. If a tool call returns an error, you may retry with corrected parameters (up to 3 times).";
        }

        var chatMessagesEl = null;
        var scrollToBottom = function() {
          if (!chatMessagesEl) chatMessagesEl = document.getElementById('llm-chat-messages');
          if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        };

        self.addMessage({ role: 'assistant', content: '', messageId: streamMsgId });

        self._currentCancelToken = new AbortController();
        self.setState({ isTyping: true });
        window.dispatchEvent(new CustomEvent('docbuddy-chat-streaming', { detail: { streaming: true } }));

        var accumulated = "";
        var currentStreamMessageId = streamMsgId;

        var lastResponseText = "";

        var accumulatedToolCalls = {};

        var finalize = function(content, saveContent, isError) {
          if (saveContent && content && content.trim() && content !== "*(cancelled)*") {
            var isErrorMsg = isError || (content && content.toLowerCase().startsWith('error:'));

            if (isErrorMsg) {
              var errorInfo = self._getErrorMessage({ message: content }, lastResponseText);
              self.addMessage({
                role: 'assistant',
                content: content,
                messageId: streamMsgId,
                isError: true,
                _errorInfo: errorInfo
              });
            } else {
              self.addMessage({ role: 'assistant', content: content, messageId: streamMsgId });
            }
          }
          self._currentCancelToken = null;
          self.setState({ isTyping: false });
          window.dispatchEvent(new CustomEvent('docbuddy-chat-streaming', { detail: { streaming: false } }));
          setTimeout(scrollToBottom, 30);
        };

        var messages = [{ role: 'system', content: systemPrompt }].concat(apiMessages);

        var payload = {
          messages: messages,
          model: settings.modelId || "llama3",
          max_tokens: settings.maxTokens != null && settings.maxTokens !== '' ? parseInt(settings.maxTokens) : 4096,
          temperature: settings.temperature != null && settings.temperature !== '' ? parseFloat(settings.temperature) : 0.7,
          stream: true,
        };

        if (toolSettings.enableTools && fullSchema) {
          payload.tools = [DB.buildApiRequestTool(fullSchema)];
          payload.tool_choice = "auto";
        }

        var fetchHeaders = {
          "Content-Type": "application/json",
        };
        if (settings.apiKey) {
          fetchHeaders["Authorization"] = "Bearer " + settings.apiKey;
        }

        var baseUrl = (settings.baseUrl || "").replace(/\/+$/, "");

        fetch(baseUrl + "/chat/completions", {
          method: "POST",
          headers: fetchHeaders,
          body: JSON.stringify(payload),
          signal: self._currentCancelToken.signal
        })
          .then(function (res) {
            if (!res.ok) {
              return res.text().then(function(text) {
                throw new Error("HTTP " + res.status + ": " + res.statusText + (text ? " - " + text : ""));
              });
            }
            var reader = res.body.getReader();
            var decoder = new TextDecoder();
            var buffer = "";

            var processChunk = function() {
              return reader.read().then(function (result) {
                if (self._currentCancelToken && self._currentCancelToken.signal.aborted) {
                  finalize(accumulated, true);
                  return;
                }
                if (result.done) {
                  finalize(accumulated || "Sorry, I couldn't get a response.", true);
                  return;
                }

                buffer += decoder.decode(result.value, { stream: true });
                var lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (var i = 0; i < lines.length; i++) {
                  var line = lines[i].trim();
                  if (!line || !line.startsWith("data: ")) continue;
                  var payloadData = line.substring(6);

                  if (payloadData === "[DONE]") {
                    finalize(accumulated || "Sorry, I couldn't get a response.", true);
                    return;
                  }

                  try {
                    var chunk = JSON.parse(payloadData);
                    if (chunk.error) {
                      finalize("Error: " + chunk.error + (chunk.details ? ": " + chunk.details : ""), true, true);
                      return;
                    }

                    var choice = chunk.choices && chunk.choices[0];
                    if (!choice) continue;

                    if (choice.delta && choice.delta.content) {
                      accumulated += choice.delta.content;
                      self.setState(function (prev) {
                        var history = prev.chatHistory || [];
                        if (history.length > 0 && history[history.length - 1].role === 'assistant' &&
                            history[history.length - 1].messageId === currentStreamMessageId) {
                          var updated = history.slice(0, -1).concat([{
                            role: 'assistant',
                            content: accumulated,
                            messageId: history[history.length - 1].messageId
                          }]);
                          self._debouncedSaveChatHistory(updated);
                          return { chatHistory: updated };
                        }
                        return {};
                      });
                      scrollToBottom();
                    }

                    if (choice.delta && choice.delta.tool_calls) {
                      choice.delta.tool_calls.forEach(function(tc) {
                        var idx = tc.index != null ? tc.index : 0;
                        if (!accumulatedToolCalls[idx]) {
                          accumulatedToolCalls[idx] = { id: '', function: { name: '', arguments: '' } };
                        }
                        if (tc.id) accumulatedToolCalls[idx].id = tc.id;
                        if (tc.function) {
                          if (tc.function.name) accumulatedToolCalls[idx].function.name = tc.function.name;
                          if (tc.function.arguments) accumulatedToolCalls[idx].function.arguments += tc.function.arguments;
                        }
                      });
                    }

                    if (choice.finish_reason === "tool_calls") {
                      var toolCallsList = Object.keys(accumulatedToolCalls).map(function(k) {
                        return accumulatedToolCalls[k];
                      });

                      if (toolCallsList.length > 0) {
                        var tc = toolCallsList[0];
                        var args = {};
                        try {
                          args = JSON.parse(tc.function.arguments || '{}');
                        } catch (e) {
                          args = {};
                        }

                        var assistantToolMsg = {
                          role: 'assistant',
                          content: null,
                          tool_calls: toolCallsList.map(function(t) {
                            return { id: t.id, type: 'function', function: { name: t.function.name, arguments: t.function.arguments } };
                          }),
                          messageId: streamMsgId
                        };
                        self._pendingToolCallMsg = assistantToolMsg;

                        self.setState(function(prev) {
                          var history = (prev.chatHistory || []).filter(function(m) {
                            return m.messageId !== streamMsgId;
                          });
                          DB.saveChatHistory(history);
                          return { chatHistory: history };
                        });

                        self.setState({
                          isTyping: false,
                          pendingToolCall: tc,
                          editMethod: args.method || 'GET',
                          editPath: args.path || '',
                          editQueryParams: JSON.stringify(args.query_params || {}, null, 2),
                          editPathParams: JSON.stringify(args.path_params || {}, null, 2),
                          editBody: JSON.stringify(args.body || {}, null, 2),
                          toolCallResponse: null,
                        }, function() {
                          if (toolSettings.autoExecute) {
                            self.handleExecuteToolCall();
                          }
                        });
                        window.dispatchEvent(new CustomEvent('docbuddy-chat-streaming', { detail: { streaming: false } }));
                        self._currentCancelToken = null;

                        return;
                      }
                    }
                  } catch (e) {
                    if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
                      console.error('Error processing streaming chunk:', payloadData, e);
                    }
                  }
                }

                return processChunk();
              });
            };

            return processChunk();
          })
          .catch(function (err) {
            if (err.name === 'AbortError') {
              finalize(accumulated, true);
            } else {
              finalize("Error: " + (err.message || "Request failed"), true, true);
            }
          });

        setTimeout(scrollToBottom, 50);
      }

      handleSend() {
        if (!this.state.input.trim() || this.state.isTyping) return;

        var self = this;
        var userInput = this.state.input.trim();
        var msgId = DB.generateMessageId();
        var streamMsgId = DB.generateMessageId();

        self._pendingToolCallMsg = null;
        self.setState({ input: "", pendingToolCall: null, toolCallResponse: null, toolRetryCount: 0 });

        var userMsg = { role: 'user', content: userInput, messageId: msgId };
        var currentHistory = self.state.chatHistory || [];
        var apiMessages = DB.buildApiMessages(currentHistory.concat([userMsg]));

        self.addMessage(userMsg);

        self._streamLLMResponse(apiMessages, streamMsgId, DB._cachedOpenapiSchema);
      }

      handleBubbleClick(msgId, text) {
        if (!text || !msgId) return;
        var self = this;
        DB.copyToClipboard(text).then(function(copied) {
          if (copied) {
            self.setState({ copiedId: msgId });
            if (self._copyTimeoutId) clearTimeout(self._copyTimeoutId);
            self._copyTimeoutId = setTimeout(function() {
              self._copyTimeoutId = null;
              self.setState({ copiedId: null });
            }, 2000);
          }
        }).catch(function(err) {
          console.error('Failed to copy:', err);
        });
      }

      renderTypingIndicator() {
        var React = system.React;
        return React.createElement(
          "div",
          { className: "llm-typing-indicator" },
          React.createElement("span", null, "Assistant is typing"),
          React.createElement("span", { className: "llm-typing-dot", style: { animationDelay: '-0.32s' } }),
          React.createElement("span", { className: "llm-typing-dot", style: { animationDelay: '-0.16s' } }),
          React.createElement("span", { className: "llm-typing-dot" })
        );
      }

      clearHistory() {
        DB.saveChatHistory([]);
        this.setState({ chatHistory: [] });
      }

      renderMessage(msg, idx) {
        var React = system.React;
        var self = this;
        var isUser = msg.role === 'user';
        var isTool = msg.role === 'tool';
        var isToolCallMsg = msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0;

        var chatHistory = self.state.chatHistory || [];
        var isStreamingThisMessage = self.state.isTyping &&
          !isUser &&
          idx === chatHistory.length - 1 &&
          msg.role === 'assistant';

        if (isToolCallMsg) {
          var toolArgs = msg._toolArgs || {};
          var tcMethod = toolArgs.method || 'GET';
          var tcPath = toolArgs.path || '';
          var tcQueryParams = toolArgs.query_params || {};
          var tcPathParams = toolArgs.path_params || {};
          var tcBody = toolArgs.body || {};

          var curlCommand = DB.buildCurlCommand(tcMethod, tcPath, tcQueryParams, tcPathParams, tcBody);

          return React.createElement(
            "div",
            { key: msg.messageId || msg.timestamp, className: "llm-chat-message-wrapper" },
            React.createElement(
              "div",
              {
                className: "llm-chat-message assistant",
                style: { maxWidth: "90%", borderLeft: "3px solid #8b5cf6" }
              },
              React.createElement(
                "div",
                { style: { flex: 1, minWidth: 0 } },
                React.createElement(
                  "div",
                  { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" } },
                  React.createElement("span", {
                    style: {
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "#8b5cf6",
                      background: "rgba(139, 92, 246, 0.1)",
                      padding: "2px 8px",
                      borderRadius: "4px"
                    }
                  }, "api_request"),
                  React.createElement("span", {
                    style: {
                      background: tcMethod === 'POST' ? '#f59e0b' : '#10b981',
                      color: '#fff',
                      padding: '1px 6px',
                      borderRadius: '3px',
                      fontSize: '10px',
                      fontWeight: '600',
                      fontFamily: "'Consolas', 'Monaco', monospace",
                    }
                  }, tcMethod),
                  React.createElement("span", {
                    style: { fontSize: "12px", fontFamily: "'Consolas', 'Monaco', monospace", color: "var(--theme-text-primary)" }
                  }, tcPath)
                ),
                React.createElement(CodeBlock, {
                  key: "curl-codeblock",
                  text: curlCommand,
                  language: "shell",
                  messageId: msg.messageId
                })
              )
            )
          );
        }

        if (isTool) {
          var statusLine = msg._displayContent || 'Tool result';
          var responseBody = '';
          var statusColor = '#10b981';
          if (msg.content) {
            var parts = msg.content.split('\n\n');
            var statusPart = parts[0] || '';
            responseBody = parts.slice(1).join('\n\n');
            var statusMatch = statusPart.match(/Status:\s*(\d+)/);
            if (statusMatch) {
              var code = parseInt(statusMatch[1]);
              statusColor = (code >= 200 && code < 300) ? '#10b981' : '#f87171';
            }
          }
          var formattedBody = responseBody;
          try {
            var parsed = JSON.parse(responseBody);
            formattedBody = JSON.stringify(parsed, null, 2);
          } catch (e) {}

          return React.createElement(
            "div",
            { key: msg.messageId || msg.timestamp, className: "llm-chat-message-wrapper" },
            React.createElement(
              "div",
              {
                className: "llm-chat-message assistant",
                onClick: function() { self.handleBubbleClick(msg.messageId, responseBody); },
                style: { maxWidth: "90%", borderLeft: "3px solid " + statusColor, cursor: "pointer" }
              },
              React.createElement(
                "div",
                { style: { flex: 1, minWidth: 0 } },
                React.createElement(
                  "div",
                  {
                    className: "llm-chat-message-header",
                    style: { display: "flex", justifyContent: "space-between", alignItems: "center" }
                  },
                  React.createElement("span", { style: { fontSize: "13px", fontWeight: "600", color: statusColor } }, statusLine),
                  self.state.copiedId === msg.messageId
                  ? React.createElement("span", { style: { fontSize: "11px", color: "#10b981", fontWeight: "500" } }, "✓ Copied")
                  : null
                ),
                React.createElement(CodeBlock, {
                  key: "tool-response-codeblock",
                  text: formattedBody ? formattedBody.substring(0, 2000) : '',
                  language: "json",
                  messageId: msg.messageId
                })
              )
            )
          );
        }

        return React.createElement(
          "div",
          { key: msg.messageId || msg.timestamp, className: "llm-chat-message-wrapper" },
          React.createElement(
            "div",
            {
              className: "llm-chat-message " + (isUser ? 'user' : 'assistant'),
              onClick: function() { self.handleBubbleClick(msg.messageId, msg.content); },
              style: { maxWidth: isUser ? "85%" : "90%", cursor: "pointer", position: "relative" }
            },
            self.state.copiedId === msg.messageId
              ? React.createElement("div", {
                  style: {
                    position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                    background: "rgba(16, 185, 129, 0.95)", color: "#fff", padding: "6px 16px",
                    borderRadius: "6px", fontSize: "12px", fontWeight: "600", zIndex: 10,
                    pointerEvents: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                    animation: "llm-fade-in 0.15s ease"
                  }
                }, "✓ Copied!")
              : null,
            React.createElement(
              "div",
              { className: "llm-chat-message-header" },
              isUser
                ? null
                : React.createElement("span", { className: "llm-assistant-label" }, "Assistant")
            ),
            React.createElement(
              "div",
              { className: "llm-chat-message-content" },
              msg._errorInfo
                ? this._renderErrorInChat(msg._errorInfo)
                : this.formatMessageContent(msg.content, isStreamingThisMessage)
            )
          )
        );
      }

      formatMessageContent(content, isStreaming) {
        var React = system.React;

        if (!content || !content.trim()) {
          if (isStreaming) {
            return React.createElement("span", {
              className: "llm-streaming-indicator",
              style: { fontStyle: 'italic', opacity: 0.7, fontSize: '13px', marginTop: '8px' }
            }, "Stream starting...");
          }
          return null;
        }

        var html = DB.parseMarkdown(content);

        return React.createElement("div", {
          className: "llm-chat-message-text",
          style: { fontSize: '15px', lineHeight: '1.6', wordWrap: 'break-word', overflowWrap: 'break-word' },
          dangerouslySetInnerHTML: { __html: html }
        });
      }

      renderToolCallPanel() {
        var React = system.React;
        var self = this;
        var s = this.state;

        if (!s.pendingToolCall) return null;

        var panelStyle = {
          padding: "10px 12px",
          borderTop: "1px solid var(--theme-border-color)",
          background: "var(--theme-panel-bg)",
          fontSize: "13px",
        };
        var inputStyle = {
          background: "var(--theme-input-bg)",
          border: "1px solid var(--theme-border-color)",
          borderRadius: "4px",
          color: "var(--theme-text-primary)",
          padding: "5px 8px",
          fontSize: "12px",
          fontFamily: "'Consolas', 'Monaco', monospace",
          width: "100%",
          boxSizing: "border-box",
        };
        var labelStyle = { color: "var(--theme-text-secondary)", fontSize: "11px", marginBottom: "2px" };
        var headerStyle = { color: "var(--theme-text-primary)", fontSize: "13px", fontWeight: "600", marginBottom: "6px" };

        return React.createElement(
          "div",
          { style: panelStyle },
          React.createElement("div", { style: headerStyle },
            React.createElement("span", null, "api_request"),
            React.createElement("span", { style: { color: "var(--theme-text-secondary)", fontWeight: "400", fontSize: "12px" } },
              s.editMethod + " " + s.editPath
            )
          ),
          React.createElement("div", { style: { display: "flex", gap: "6px", marginBottom: "8px", alignItems: "flex-end" } },
            React.createElement(
              "div",
              { style: { flex: "0 0 80px" } },
              React.createElement("div", { style: labelStyle }, "Method"),
              React.createElement("select", { value: s.editMethod, onChange: function(e) { self.setState({ editMethod: e.target.value }); }, style: inputStyle },
                React.createElement("option", { value: "GET" }, "GET"),
                React.createElement("option", { value: "POST" }, "POST"),
                React.createElement("option", { value: "PUT" }, "PUT"),
                React.createElement("option", { value: "PATCH" }, "PATCH"),
                React.createElement("option", { value: "DELETE" }, "DELETE")
              )
            ),
            React.createElement(
              "div",
              { style: { flex: 1 } },
              React.createElement("div", { style: labelStyle }, "Path"),
              React.createElement("input", { type: "text", value: s.editPath, onChange: function(e) { self.setState({ editPath: e.target.value }); }, style: inputStyle })
            ),
            React.createElement(
              "div",
              { style: { flex: 1 } },
              React.createElement("div", { style: labelStyle }, "Query"),
              React.createElement("input", { type: "text", value: s.editQueryParams, onChange: function(e) { self.setState({ editQueryParams: e.target.value }); }, style: inputStyle, placeholder: '{}' })
            )
          ),
          (s.editMethod === 'POST' || s.editMethod === 'PUT' || s.editMethod === 'PATCH') && React.createElement("div", { style: { marginBottom: "8px" } },
            React.createElement("div", { style: Object.assign({}, labelStyle, { display: "flex", alignItems: "center", justifyContent: "space-between" }) },
              "Body",
              React.createElement("span", { style: { fontSize: "10px", color: "var(--theme-text-secondary)", fontWeight: "400" } }, "JSON")
            ),
            React.createElement("textarea", { value: s.editBody, onChange: function(e) { self.setState({ editBody: e.target.value }); }, style: Object.assign({}, inputStyle, { resize: "vertical", minHeight: "72px" }), rows: 4, placeholder: '{}' })
          ),
          React.createElement(
            "div",
            { style: { display: "flex", gap: "8px" } },
            React.createElement("button", {
              onClick: self.handleExecuteToolCall,
              style: { background: "var(--theme-primary)", color: "#fff", border: "none", borderRadius: "4px", padding: "5px 14px", cursor: "pointer", fontSize: "12px", fontWeight: "500" }
            }, "▶ Execute"),
            React.createElement("button", {
              onClick: function() { self._pendingToolCallMsg = null; self.setState({ pendingToolCall: null, toolCallResponse: null }); },
              style: { background: "var(--theme-accent)", color: "#fff", border: "none", borderRadius: "4px", padding: "5px 14px", cursor: "pointer", fontSize: "12px" }
            }, "Dismiss")
          )
        );
      }

      render() {
        var React = system.React;
        var self = this;
        var chatHistory = this.state.chatHistory || [];

        return React.createElement(
          "div",
          { className: "llm-chat-container", style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '300px' } },
          React.createElement(
            "div",
            { id: "llm-chat-messages", style: { flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px', scrollBehavior: 'smooth' } },
            chatHistory.length === 0
              ? React.createElement(
                  "div",
                  { style: { textAlign: 'center', color: 'var(--theme-text-secondary)', padding: '40px 20px', fontSize: '20px', whiteSpace: 'pre-line' } },
                  "Ask questions about your API!\n\nExamples:\n• What endpoints are available?\n• How do I use the chat completions endpoint?\n• Generate a curl command for /health"
                )
              : chatHistory.map(this.renderMessage)
            ),
          this.state.isTyping
            ? React.createElement(
                "div",
                { style: { padding: '8px 12px', color: 'var(--theme-text-secondary)', fontSize: '12px' } },
                this.renderTypingIndicator()
              )
            : null,
          this.state.pendingToolCall && !this.state.isTyping ? this.renderToolCallPanel() : null,
          React.createElement(
            "div",
            { className: "llm-chat-input-area", style: { borderTop: '1px solid var(--theme-border-color)', padding: '12px', width: '100%', maxWidth: '100%', boxSizing: 'border-box', flexShrink: 0 } },
            React.createElement("textarea", {
              value: this.state.input,
              onChange: this.handleInputChange,
              onKeyDown: this.handleKeyDown,
              placeholder: "Ask about your API... (Shift+Enter for new line)",
              style: { width: '100%', background: 'var(--theme-input-bg)', border: '1px solid var(--theme-border-color)', borderRadius: '4px', color: 'var(--theme-text-primary)', padding: '10px 12px', fontSize: '14px', resize: 'vertical', fontFamily: "'Inter', sans-serif", minHeight: '44px', maxHeight: '200px', overflowWrap: 'break-word', wordWrap: 'break-word', overflowX: 'hidden', boxSizing: 'border-box', lineHeight: '1.5' },
              rows: 2
            }),
            React.createElement(
              "div",
              { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' } },
              React.createElement(
                "div",
                { style: { display: 'flex', gap: '8px' } },
                React.createElement(
                  "button",
                  {
                    onClick: this.clearHistory,
                    disabled: this.state.isTyping || !!this.state.pendingToolCall,
                    style: { border: 'none', borderRadius: '6px', cursor: (this.state.isTyping || !!this.state.pendingToolCall) ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: '500', transition: 'all 0.2s ease', background: 'var(--theme-accent)', opacity: (this.state.isTyping || !!this.state.pendingToolCall) ? 0.6 : 1, color: '#fff', padding: '8px 12px' }
                  },
                  "Clear"
                ),
                React.createElement(
                  "button",
                  {
                    onClick: function() {
                      var history = self.state.chatHistory || [];
                      if (history.length === 0) return;
                      DB.exportAsJson(history, 'chat-history-' + new Date().toISOString().slice(0, 10) + '.json');
                    },
                    disabled: !(this.state.chatHistory && this.state.chatHistory.length > 0),
                    style: { border: 'none', borderRadius: '6px', cursor: (this.state.chatHistory && this.state.chatHistory.length > 0) ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: '500', transition: 'all 0.2s ease', background: 'var(--theme-secondary)', opacity: (this.state.chatHistory && this.state.chatHistory.length > 0) ? 1 : 0.5, color: 'var(--theme-text-primary)', padding: '8px 12px' }
                  },
                  "⬇ Export"
                )
              ),
              React.createElement(
                "div",
                { style: { display: 'flex', gap: '8px' } },
                this.state.isTyping && React.createElement(
                  "button",
                  {
                    onClick: this.handleCancel,
                    style: { border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '500', background: '#dc2626', color: '#fff', padding: '8px 16px' }
                  },
                "❌ Cancel"
              ),
              React.createElement(
                "button",
                {
                  onClick: this.handleSend,
                  disabled: !this.state.input.trim() || this.state.isTyping,
                  style: { border: 'none', borderRadius: '6px', cursor: (!this.state.input.trim() || this.state.isTyping) ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: '500', transition: 'all 0.2s ease', background: 'var(--theme-primary)', opacity: (!this.state.input.trim() || this.state.isTyping) ? 0.6 : 1, color: '#fff', padding: '8px 16px' }
                },
                this.state.isTyping ? "..." : "Send"
              )
            )
          )
          )
        );
      }
    };
  }

  DB.ChatPanelFactory = ChatPanelFactory;

})();
