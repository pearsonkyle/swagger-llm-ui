// DocBuddy Workflow Panel — Multi-step AI workflow builder with tool calling
// Depends on: docbuddy-core.js (window.DocBuddy)

(function () {
  "use strict";

  var DB = window.DocBuddy;

  // ── Workflow panel component ───────────────────────────────────────────────
  function WorkflowPanelFactory(system) {
    var React = system.React;

    return class WorkflowPanel extends React.Component {
      constructor(props) {
        super(props);
        var saved = DB.loadWorkflow();
        var initialBlocks;
        if (saved && saved.blocks && saved.blocks.length) {
          initialBlocks = saved.blocks.map(function (block) {
            return Object.assign({}, block, {
              output: '',
              status: 'idle'
            });
          });
        } else {
          initialBlocks = [DB.createDefaultBlock()];
        }
        this.state = {
          blocks: initialBlocks,
          running: false,
          currentBlockIdx: -1,
          aborted: false,
          copiedBlockId: null,
        };
        this._abortController = null;
        this.handleStart = this.handleStart.bind(this);
        this.handleStop = this.handleStop.bind(this);
        this.handleReset = this.handleReset.bind(this);
        this.handleAddBlock = this.handleAddBlock.bind(this);
        this.handleRemoveBlock = this.handleRemoveBlock.bind(this);
        this.handleBlockContentChange = this.handleBlockContentChange.bind(this);
        this.handleToggleBlockTools = this.handleToggleBlockTools.bind(this);
        this.runWorkflow = this.runWorkflow.bind(this);
      }

      componentDidMount() {
        DB.ensureOpenapiSchemaCached();
      }

      componentDidUpdate(prevProps, prevState) {
        if (prevState.blocks !== this.state.blocks && !this.state.running) {
          var persistedBlocks = this.state.blocks.map(function(b) {
            return { id: b.id, type: b.type, content: b.content, enableTools: b.enableTools !== false };
          });
          DB.saveWorkflow({ blocks: persistedBlocks });
        }
      }

      componentWillUnmount() {
        if (this._abortController) {
          this._abortController.abort();
          this._abortController = null;
        }
        window.dispatchEvent(new CustomEvent('docbuddy-workflow-streaming', { detail: { streaming: false } }));
      }

      handleAddBlock() {
        this.setState(function(prev) {
          return { blocks: prev.blocks.concat([DB.createDefaultBlock()]) };
        });
      }

      handleRemoveBlock(blockId) {
        this.setState(function(prev) {
          if (prev.blocks.length <= 1) return {};
          return { blocks: prev.blocks.filter(function(b) { return b.id !== blockId; }) };
        });
      }

      handleBlockContentChange(blockId, value) {
        this.setState(function(prev) {
          return {
            blocks: prev.blocks.map(function(b) {
              if (b.id === blockId) return Object.assign({}, b, { content: value });
              return b;
            })
          };
        });
      }

      handleToggleBlockTools(blockId) {
        this.setState(function(prev) {
          return {
            blocks: prev.blocks.map(function(b) {
              if (b.id === blockId) return Object.assign({}, b, { enableTools: b.enableTools === false ? true : false });
              return b;
            })
          };
        });
      }

      handleStart() {
        var self = this;
        var hasContent = self.state.blocks.some(function(b) { return b.content && b.content.trim(); });
        if (!hasContent) return;
        if (self._abortController) {
          self._abortController.abort();
          self._abortController = null;
        }
        window.dispatchEvent(new CustomEvent('docbuddy-workflow-streaming', { detail: { streaming: true } }));
        self.setState(function(prev) {
          return {
            running: true,
            aborted: false,
            currentBlockIdx: 0,
            blocks: prev.blocks.map(function(b) {
              return Object.assign({}, b, { output: '', status: 'idle' });
            })
          };
        }, function() {
          self.runWorkflow();
        });
      }

      handleStop() {
        if (this._abortController) {
          this._abortController.abort();
        }
        window.dispatchEvent(new CustomEvent('docbuddy-workflow-streaming', { detail: { streaming: false } }));
        this.setState({ running: false, aborted: true, currentBlockIdx: -1 });
      }

      handleReset() {
        if (this._abortController) {
          this._abortController.abort();
        }
        window.dispatchEvent(new CustomEvent('docbuddy-workflow-streaming', { detail: { streaming: false } }));
        var defaultBlock = DB.createDefaultBlock();
        this.setState({
          blocks: [defaultBlock],
          running: false,
          currentBlockIdx: -1,
          aborted: false,
        });
        DB.saveWorkflow({ blocks: [defaultBlock] });
      }

      runWorkflow() {
        var self = this;
        var conversationHistory = [];

        function runBlock(idx) {
          var currentBlocks = self.state.blocks;
          if (idx >= currentBlocks.length || self.state.aborted) {
            window.dispatchEvent(new CustomEvent('docbuddy-workflow-streaming', { detail: { streaming: false } }));
            self.setState({ running: false, currentBlockIdx: -1 });
            return;
          }

          self.setState({ currentBlockIdx: idx });

          var block = currentBlocks[idx];
          var updatedBlocks = currentBlocks.slice();
          updatedBlocks[idx] = Object.assign({}, updatedBlocks[idx], { status: 'running', output: '' });
          self.setState({ blocks: updatedBlocks });

          var settings = DB.loadFromStorage();
          var toolSettings = DB.loadToolSettings();
          var blockToolsEnabled = toolSettings.enableTools && (block.enableTools !== false);

          var selectedPreset = settings.systemPromptPreset || 'api_assistant';
          var systemPrompt = DB.getSystemPromptForPreset(selectedPreset, DB._cachedOpenapiSchema);

          if (blockToolsEnabled) {
            systemPrompt = systemPrompt.replace(/## Tool Calling Instructions[\s\S]*$/, '').trimEnd();
            systemPrompt += '\n\nUse the `api_request` tool via native tool calling when the user asks to call an API endpoint. Do NOT output tool calls as JSON text — the system handles tool execution automatically.';
          }
          systemPrompt += '\n\nYou are executing a multi-step workflow. Be concise. Execute each instruction precisely.';

          var currentUserMessage = { role: 'user', content: block.content || '' };

          var messages = [{ role: 'system', content: systemPrompt }]
            .concat(conversationHistory)
            .concat([currentUserMessage]);

          var payload = {
            messages: messages,
            model: settings.modelId || 'llama3',
            max_tokens: settings.maxTokens != null && settings.maxTokens !== '' ? parseInt(settings.maxTokens) : 4096,
            temperature: settings.temperature != null && settings.temperature !== '' ? parseFloat(settings.temperature) : 0.7,
            stream: true,
          };

          if (blockToolsEnabled) {
            var fullSchema = DB._cachedOpenapiSchema;
            if (fullSchema) {
              payload.tools = [DB.buildApiRequestTool(fullSchema)];
              payload.tool_choice = 'auto';
            }
          }

          var fetchHeaders = { 'Content-Type': 'application/json' };
          if (settings.apiKey) {
            fetchHeaders['Authorization'] = 'Bearer ' + settings.apiKey;
          }

          var baseUrl = (settings.baseUrl || '').replace(/\/+$/, '');

          if (self._abortController && typeof self._abortController.abort === 'function') {
            try { self._abortController.abort(); } catch (e) {}
          }

          self._abortController = new AbortController();
          var accumulated = '';
          var accumulatedToolCalls = {};

          var blockMessages = [];

          fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: fetchHeaders,
            body: JSON.stringify(payload),
            signal: self._abortController.signal
          })
            .then(function(res) {
              if (!res.ok) {
                return res.text().then(function(text) {
                  throw new Error('HTTP ' + res.status + ': ' + res.statusText + (text ? ' - ' + text : ''));
                });
              }
              var reader = res.body.getReader();
              var decoder = new TextDecoder();
              var buffer = '';

              function processChunk() {
                return reader.read().then(function(result) {
                  if (self.state.aborted) return;
                  if (result.done) {
                    return finishBlock(accumulated, blockMessages);
                  }

                  buffer += decoder.decode(result.value, { stream: true });
                  var lines = buffer.split('\n');
                  buffer = lines.pop() || '';

                  for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (!line || !line.startsWith('data: ')) continue;
                    var payloadData = line.substring(6);
                    if (payloadData === '[DONE]') {
                      return finishBlock(accumulated, blockMessages);
                    }

                    try {
                      var chunk = JSON.parse(payloadData);
                      if (chunk.error) {
                        var errMsg = typeof chunk.error === 'string' ? chunk.error
                          : (chunk.error.message || JSON.stringify(chunk.error));
                        return finishBlock('Error: ' + errMsg, blockMessages);
                      }
                      var choice = chunk.choices && chunk.choices[0];
                      if (!choice) continue;

                      if (choice.delta && choice.delta.content) {
                        accumulated += choice.delta.content;
                        var currentBlocks = self.state.blocks.slice();
                        currentBlocks[idx] = Object.assign({}, currentBlocks[idx], { output: accumulated });
                        self.setState({ blocks: currentBlocks });
                      }

                      if (choice.delta && choice.delta.tool_calls) {
                        choice.delta.tool_calls.forEach(function(tc) {
                          var tcIdx = tc.index != null ? tc.index : 0;
                          if (!accumulatedToolCalls[tcIdx]) {
                            accumulatedToolCalls[tcIdx] = { id: '', function: { name: '', arguments: '' } };
                          }
                          if (tc.id) accumulatedToolCalls[tcIdx].id = tc.id;
                          if (tc.function) {
                            if (tc.function.name) accumulatedToolCalls[tcIdx].function.name = tc.function.name;
                            if (tc.function.arguments) accumulatedToolCalls[tcIdx].function.arguments += tc.function.arguments;
                          }
                        });
                      }

                      if (choice.finish_reason === 'tool_calls') {
                        var toolCallsList = Object.keys(accumulatedToolCalls).map(function(k) {
                          return accumulatedToolCalls[k];
                        });
                        if (toolCallsList.length > 0) {
                          executeToolCall(toolCallsList[0], toolCallsList, function(toolOutput) {
                            var firstToolCall = toolCallsList[0];

                            blockMessages.push({
                              role: 'assistant',
                              content: null,
                              tool_calls: toolCallsList.map(function(tc) {
                                return { id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } };
                              })
                            });

                            blockMessages.push({
                              role: 'tool',
                              tool_call_id: firstToolCall.id,
                              content: toolOutput
                            });

                            var tcArgs = {};
                            try { tcArgs = JSON.parse(firstToolCall.function.arguments || '{}'); } catch (e) {}
                            var curlCmd = DB.buildCurlCommand(
                              tcArgs.method || 'GET',
                              tcArgs.path || '',
                              tcArgs.query_params || {},
                              tcArgs.path_params || {},
                              tcArgs.body || {}
                            );
                            accumulated += '\n\n[Tool Call]\n' + curlCmd + '\n\n[Tool Result]\n' + toolOutput;
                            var currentBlocks2 = self.state.blocks.slice();
                            currentBlocks2[idx] = Object.assign({}, currentBlocks2[idx], { output: accumulated });
                            self.setState({ blocks: currentBlocks2 });

                            finishBlock(accumulated, blockMessages);
                          });
                          return;
                        }
                      }
                    } catch (e) {
                      console.error('Error processing streaming chunk:', payloadData, e);
                    }
                  }

                  return processChunk();
                });
              }

              return processChunk();
            })
            .catch(function(err) {
              if (err && err.name === 'AbortError') {
                self._abortController = null;
                return;
              }
              finishBlock('Error: ' + (err && err.message ? err.message : 'Request failed'), blockMessages);
            });

          function executeToolCall(tc, toolCallsList, callback) {
            var args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
            var method = args.method || 'GET';
            var url = args.path || '';

            if (!url || !/^\/[^\/\\]/.test(url)) {
              callback('Error: Tool call path must be a relative URL starting with /');
              return;
            }

            try {
              var pathParams = args.path_params || {};
              Object.keys(pathParams).forEach(function(key) {
                url = url.replace('{' + key + '}', encodeURIComponent(pathParams[key]));
              });
            } catch (e) {}

            try {
              var queryParams = args.query_params || {};
              var queryKeys = Object.keys(queryParams);
              if (queryKeys.length > 0) {
                var qs = queryKeys.map(function(k) {
                  return encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]);
                }).join('&');
                url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
              }
            } catch (e) {}

            url = window.location.origin + url;

            var toolFetchHeaders = {};
            var tSettings = DB.loadToolSettings();
            var toolApiKey = tSettings.apiKey && typeof tSettings.apiKey === 'string' ? tSettings.apiKey.trim() : '';
            if (toolApiKey) {
              toolFetchHeaders['Authorization'] = 'Bearer ' + toolApiKey;
            }

            var hasBody = args.body && (method === 'POST' || method === 'PUT' || method === 'PATCH');
            if (hasBody) {
              toolFetchHeaders['Content-Type'] = 'application/json';
            }

            var fetchOpts = { method: method, headers: toolFetchHeaders };
            if (hasBody) {
              fetchOpts.body = JSON.stringify(args.body);
            }

            if (self._abortController) {
              fetchOpts.signal = self._abortController.signal;
            }

            fetch(url, fetchOpts)
              .then(function(res) {
                if (self.state.aborted) return;
                return res.text().then(function(text) {
                  if (self.state.aborted) return;
                  callback('Status: ' + res.status + ' ' + res.statusText + '\n\n' + text.substring(0, 4000));
                });
              })
              .catch(function(err) {
                if (err && err.name === 'AbortError') return;
                callback('Error: ' + err.message);
              });
          }

          function finishBlock(output, historyMessages) {
            if (historyMessages && historyMessages.length > 0) {
              if (accumulated) {
                conversationHistory.push({ role: 'assistant', content: accumulated });
              }
            } else {
              conversationHistory.push({ role: 'assistant', content: output || accumulated || '' });
            }

            var currentBlocks = self.state.blocks.slice();
            currentBlocks[idx] = Object.assign({}, currentBlocks[idx], {
              output: output || '(no output)',
              status: 'done'
            });
            self.setState({ blocks: currentBlocks }, function() {
              runBlock(idx + 1);
            });
          }
        }

        runBlock(0);
      }

      render() {
        var React = system.React;
        var self = this;
        var s = this.state;

        var containerStyle = {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
          overflow: 'hidden',
        };

        var toolbarStyle = {
          display: 'flex',
          gap: '8px',
          padding: '12px 16px',
          borderBottom: '1px solid var(--theme-border-color)',
          background: 'var(--theme-panel-bg)',
          flexShrink: 0,
          flexWrap: 'wrap',
          alignItems: 'center',
        };

        var btnStyle = function(color) {
          return {
            background: color || 'var(--theme-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            padding: '6px 14px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '500',
            transition: 'all 0.2s ease',
          };
        };

        var blocksContainerStyle = {
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          WebkitOverflowScrolling: 'touch',
        };

        var hasContent = s.blocks.some(function(b) { return b.content && b.content.trim(); });
        var startDisabled = s.running || !hasContent;
        var globalToolSettings = DB.loadToolSettings();
        var globalToolsEnabled = globalToolSettings.enableTools;

        return React.createElement(
          'div',
          { style: containerStyle },
          React.createElement(
            'div',
            { style: toolbarStyle },
            React.createElement('button', {
              onClick: self.handleStart,
              disabled: startDisabled,
              style: Object.assign({}, btnStyle('#10b981'), startDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : {})
            }, '▶ Start'),
            React.createElement('button', {
              onClick: self.handleStop,
              disabled: !s.running,
              style: Object.assign({}, btnStyle('#ef4444'), !s.running ? { opacity: 0.5, cursor: 'not-allowed' } : {})
            }, '■ Stop'),
            React.createElement('button', {
              onClick: self.handleReset,
              style: btnStyle('var(--theme-accent)')
            }, '↺ Reset'),
            React.createElement('div', { style: { width: '1px', height: '24px', background: 'var(--theme-border-color)' } }),
            React.createElement('button', {
              onClick: self.handleAddBlock,
              disabled: s.running,
              style: Object.assign({}, btnStyle('var(--theme-primary)'), s.running ? { opacity: 0.5, cursor: 'not-allowed' } : {})
            }, '+ Add Block'),
            React.createElement('button', {
              onClick: function() {
                var blocks = self.state.blocks || [];
                if (blocks.length === 0) return;
                var exportData = blocks.map(function(b, i) {
                  return { block: i + 1, prompt: b.content || '', output: b.output || '', status: b.status || 'idle' };
                });
                DB.exportAsJson(exportData, 'workflow-' + new Date().toISOString().slice(0, 10) + '.json');
              },
              disabled: s.running || !hasContent,
              style: Object.assign({}, btnStyle('var(--theme-secondary)'), { color: 'var(--theme-text-primary)' }, (s.running || !hasContent) ? { opacity: 0.5, cursor: 'not-allowed' } : {})
            }, '⬇ Export'),
            s.running ? React.createElement('span', {
              style: { fontSize: '12px', color: 'var(--theme-text-secondary)', marginLeft: 'auto' }
            }, 'Running block ' + (s.currentBlockIdx + 1) + ' of ' + s.blocks.length + '…') : null
          ),
          React.createElement(
            'div',
            { style: blocksContainerStyle },
            s.blocks.length === 0
              ? React.createElement('div', {
                  style: { textAlign: 'center', color: 'var(--theme-text-secondary)', padding: '40px', fontSize: '14px' }
                }, 'No blocks yet. Click "+ Add Block" to get started.')
              : s.blocks.map(function(block, idx) {
                  var isActive = s.running && s.currentBlockIdx === idx;
                  var isDone = block.status === 'done';

                  var blockWrapperStyle = {
                    background: 'var(--theme-input-bg)',
                    border: '1px solid ' + (isActive ? 'var(--theme-primary)' : 'var(--theme-border-color)'),
                    borderRadius: '8px',
                    overflow: 'hidden',
                    transition: 'all 0.2s ease',
                    boxShadow: isActive ? '0 0 0 2px rgba(99,102,241,0.2)' : 'none',
                    flexShrink: 0,
                  };

                  var blockHeaderStyle = {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: isActive ? 'var(--theme-primary)' : 'var(--theme-panel-bg)',
                    borderBottom: '1px solid var(--theme-border-color)',
                    transition: 'all 0.2s ease',
                  };

                  var statusBadge = null;
                  if (block.status === 'running') {
                    statusBadge = React.createElement('span', {
                      style: { fontSize: '10px', fontWeight: '600', color: '#fff', background: '#f59e0b', padding: '2px 8px', borderRadius: '4px' }
                    }, 'RUNNING');
                  } else if (block.status === 'done') {
                    statusBadge = React.createElement('span', {
                      style: { fontSize: '10px', fontWeight: '600', color: '#fff', background: '#10b981', padding: '2px 8px', borderRadius: '4px' }
                    }, 'DONE');
                  }

                  return React.createElement(
                    'div',
                    { key: block.id, style: blockWrapperStyle },
                    React.createElement(
                      'div',
                      { style: blockHeaderStyle },
                      React.createElement(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                        React.createElement('span', {
                          style: {
                            color: isActive ? '#fff' : 'var(--theme-text-secondary)',
                            fontSize: '10px',
                            fontFamily: "'Inter', sans-serif",
                            fontWeight: '600',
                            textTransform: 'uppercase',
                          }
                        }, 'Block ' + (idx + 1)),
                        globalToolsEnabled ? React.createElement('span', {
                          onClick: !s.running ? function() { self.handleToggleBlockTools(block.id); } : null,
                          style: {
                            fontSize: '10px',
                            fontWeight: '600',
                            color: '#fff',
                            background: block.enableTools !== false ? '#10b981' : '#6b7280',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            cursor: s.running ? 'default' : 'pointer',
                            opacity: s.running ? 0.7 : 1,
                            userSelect: 'none',
                            transition: 'all 0.2s ease',
                          },
                          title: block.enableTools !== false ? 'Tools enabled — click to disable' : 'Tools disabled — click to enable'
                        }, block.enableTools !== false ? 'Tools ✓' : 'Tools ✗') : null,
                        statusBadge
                      ),
                      !s.running ? React.createElement('button', {
                        onClick: function() { self.handleRemoveBlock(block.id); },
                        style: {
                          background: 'transparent',
                          border: 'none',
                          color: isActive ? '#fff' : 'var(--theme-text-secondary)',
                          cursor: 'pointer',
                          fontSize: '14px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        },
                        title: 'Remove block'
                      }, '✕') : null
                    ),
                    React.createElement('textarea', {
                      value: block.content,
                      onChange: function(e) { self.handleBlockContentChange(block.id, e.target.value); },
                      disabled: s.running,
                      placeholder: 'Enter a prompt, query, or instruction for this step…',
                      style: {
                        width: '100%',
                        boxSizing: 'border-box',
                        background: 'var(--theme-input-bg)',
                        color: 'var(--theme-text-primary)',
                        border: 'none',
                        borderBottom: block.output ? '1px solid var(--theme-border-color)' : 'none',
                        padding: '12px',
                        fontSize: '13px',
                        fontFamily: "'Consolas', 'Monaco', monospace",
                        resize: 'vertical',
                        minHeight: '72px',
                        lineHeight: '1.6',
                        outline: 'none',
                      }
                    }),
                    block.output ? React.createElement(
                      'div',
                      {
                        style: {
                          padding: '0',
                          margin: 0,
                          overflowX: 'auto',
                          cursor: 'pointer',
                          position: 'relative',
                        },
                        onClick: function() {
                          DB.copyToClipboard(block.output).then(function(copied) {
                            if (copied) {
                              self.setState({ copiedBlockId: block.id });
                              setTimeout(function() {
                                self.setState({ copiedBlockId: null });
                              }, 1500);
                            }
                          });
                        },
                        title: 'Click to copy output'
                      },
                      s.copiedBlockId === block.id
                        ? React.createElement('div', {
                            style: {
                              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                              background: 'rgba(16, 185, 129, 0.95)', color: '#fff', padding: '6px 16px',
                              borderRadius: '6px', fontSize: '12px', fontWeight: '600', zIndex: 10,
                              pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                              animation: 'llm-fade-in 0.15s ease'
                            }
                          }, '✓ Copied!')
                        : null,
                      React.createElement(
                        'pre',
                        {
                          style: {
                            padding: '12px',
                            margin: 0,
                            overflowX: 'auto',
                            overflowY: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            overflowWrap: 'break-word',
                            color: isDone ? '#a5b4fc' : 'var(--theme-text-primary)',
                            lineHeight: '1.6',
                            fontSize: '13px',
                            fontFamily: "'Consolas', 'Monaco', monospace",
                            maxHeight: '400px',
                            WebkitOverflowScrolling: 'touch',
                          }
                        },
                        React.createElement('code', null, block.output)
                      )
                    ) : null
                  );
                })
          )
        );
      }
    };
  }

  DB.WorkflowPanelFactory = WorkflowPanelFactory;

})();
