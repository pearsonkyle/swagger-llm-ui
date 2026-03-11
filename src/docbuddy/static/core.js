// DocBuddy Core — shared utilities, state management, storage, and helpers
// This module establishes the window.DocBuddy namespace used by all other modules.

(function () {
  "use strict";

  var DocBuddy = window.DocBuddy = {};

  // Configurable base path for static assets (allows standalone/GitHub Pages usage)
  var STATIC_BASE = window.DOCBUDDY_STATIC_BASE || '/docbuddy-static';

  // ── System Prompt Preset Configuration (load from JSON) ───────────────────
  var SYSTEM_PROMPT_CONFIG = null;
  var _systemPromptConfigPromise = null;

  function loadSystemPromptConfig() {
    if (SYSTEM_PROMPT_CONFIG) return SYSTEM_PROMPT_CONFIG;

    // Start async fetch if not already in progress
    if (!_systemPromptConfigPromise) {
      _systemPromptConfigPromise = fetch(STATIC_BASE + '/system-prompt-config.json')
        .then(function(res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function(data) {
          SYSTEM_PROMPT_CONFIG = data;
          return data;
        })
        .catch(function(err) {
          console.error('Failed to load system-prompt-config.json:', err);
          _systemPromptConfigPromise = null;
          return null;
        });
    }

    return {
      presets: {},
      defaultPreset: 'api_assistant'
    };
  }
  DocBuddy.loadSystemPromptConfig = loadSystemPromptConfig;

  /**
   * Returns a Promise that resolves to the system prompt config.
   * Use this instead of loadSystemPromptConfig() when you need the actual loaded data.
   */
  function ensureSystemPromptConfig() {
    if (SYSTEM_PROMPT_CONFIG) return Promise.resolve(SYSTEM_PROMPT_CONFIG);
    if (_systemPromptConfigPromise) return _systemPromptConfigPromise;
    // Kick off loading
    loadSystemPromptConfig();
    return _systemPromptConfigPromise || Promise.resolve(null);
  }
  DocBuddy.ensureSystemPromptConfig = ensureSystemPromptConfig;

  // ── Get system prompt for a preset ────────────────────────────────────────
  function getSystemPromptForPreset(presetName, openapiSchema) {
    var config = loadSystemPromptConfig();
    var preset = (config.presets || {})[presetName];

    if (!preset) {
      var defaultConfig = config.presets || {};
      if (defaultConfig.api_assistant) {
        preset = defaultConfig.api_assistant;
      } else {
        return buildDefaultSystemPrompt(openapiSchema);
      }
    }

    var prompt = preset.prompt || '';

    if (prompt.includes('{openapi_context}') && openapiSchema) {
      var context = buildOpenApiContext(openapiSchema);
      prompt = prompt.replace('{openapi_context}', '\n\n' + context + '\n');
    }

    return prompt;
  }
  DocBuddy.getSystemPromptForPreset = getSystemPromptForPreset;

  // ── Default system prompt builder (fallback) ──────────────────────────────
  function buildDefaultSystemPrompt(schema) {
    var lines = [];
    lines.push('You are a helpful API assistant. The user is looking at an API documentation page for an OpenAPI-compliant REST API.');

    if (schema) {
      lines.push(buildOpenApiContext(schema));
    }

    return lines.join('\n\n');
  }

  // ── LLM Provider configurations ─────────────────────────────────────────────
  var LLM_PROVIDERS = {
    ollama: { name: 'Ollama', url: 'http://localhost:11434/v1' },
    lmstudio: { name: 'LM Studio', url: 'http://localhost:1234/v1' },
    vllm: { name: 'vLLM', url: 'http://localhost:8000/v1' },
    custom: { name: 'Custom', url: '' }
  };
  DocBuddy.LLM_PROVIDERS = LLM_PROVIDERS;

  // ── Build OpenAPI context from schema (for system prompt) ──────────────────
  function buildOpenApiContext(schema) {
    if (!schema || typeof schema !== 'object') return '';

    var lines = [];
    var info = schema.info || {};
    lines.push('# API Information');
    lines.push('## ' + (info.title || 'Untitled API'));
    lines.push('Version: ' + (info.version || 'N/A'));

    var description = info.description;
    if (description) {
      lines.push('');
      lines.push('### Description');
      lines.push(description);
    }

    var servers = schema.servers || [];
    if (servers && servers.length > 0) {
      lines.push('');
      lines.push('### Base URLs');
      servers.forEach(function(server) {
        var url = server.url || '';
        var desc = server.description || '';
        if (desc) lines.push('- ' + url + ' (' + desc + ')');
        else lines.push('- ' + url);
      });
    }

    var paths = schema.paths || {};
    if (paths && Object.keys(paths).length > 0) {
      lines.push('');
      lines.push('# API Endpoints');

      Object.keys(paths).forEach(function(path) {
        var pathItem = paths[path];
        if (typeof pathItem !== 'object') return;

        lines.push('');
        lines.push('## `' + path + '`');

        ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].forEach(function(method) {
          if (!pathItem[method] || typeof pathItem[method] !== 'object') return;

          var operation = pathItem[method];
          var verb = method.toUpperCase();
          var summary = operation.summary || '';
          var desc = operation.description || '';

          lines.push('### ' + verb);
          if (summary) {
            lines.push('**Summary:** ' + summary);
          }
          if (desc) {
            lines.push('**Description:** ' + desc);
          }

          var tags = operation.tags || [];
          if (tags.length > 0) {
            lines.push('**Tags:** ' + tags.join(', '));
          }

          var params = operation.parameters || [];
          if (params && params.length > 0) {
            lines.push('');
            lines.push('**Parameters:**');
            params.forEach(function(param) {
              if (typeof param !== 'object') return;
              var name = param.name || 'unknown';
              var inLoc = param.in || 'query';
              var required = param.required ? '[required]' : '[optional]';
              var pDesc = param.description || '';
              lines.push('- `' + name + '` (' + inLoc + ', ' + required + ') - ' + pDesc);
            });
          }

          var requestBody = operation.requestBody;
          if (requestBody && typeof requestBody === 'object') {
            var content = requestBody.content || {};
            if (Object.keys(content).length > 0) {
              lines.push('');
              lines.push('**Request Body:**');
              Object.keys(content).forEach(function(contentType) {
                var mediaType = content[contentType];
                if (typeof mediaType !== 'object') return;
                var schemaDef = mediaType.schema || {};
                if (schemaDef && typeof schemaDef === 'object') {
                  lines.push('- Content-Type: `' + contentType + '`');
                  var resolvedSchema = schemaDef;
                  if (schemaDef['$ref'] && typeof schemaDef['$ref'] === 'string') {
                    var refPath = schemaDef['$ref'].replace('#/components/schemas/', '');
                    var compSchemas = (schema.components || {}).schemas || {};
                    if (compSchemas[refPath]) {
                      resolvedSchema = compSchemas[refPath];
                      lines.push('- Schema: `' + refPath + '`');
                    }
                  }
                  if (resolvedSchema.type === 'object' || resolvedSchema.properties) {
                    var props = resolvedSchema.properties || {};
                    var requiredFields = resolvedSchema.required || [];
                    var propKeys = Object.keys(props).slice(0, 10);
                    propKeys.forEach(function(pName) {
                      var pDef = props[pName] || {};
                      var pType = pDef.type || 'any';
                      if (pType === 'array' && pDef.items) {
                        var itemRef = (pDef.items['$ref'] || '').replace('#/components/schemas/', '');
                        pType = 'array[' + (itemRef || pDef.items.type || 'object') + ']';
                      }
                      var pReq = requiredFields.indexOf(pName) >= 0 ? 'required' : 'optional';
                      var pDesc = pDef.description || '';
                      lines.push('  - `' + pName + '` (' + pType + ', ' + pReq + ')' + (pDesc ? ': ' + pDesc : ''));
                    });
                  }
                }
              });
            }
          }

          var responses = operation.responses || {};
          if (responses && Object.keys(responses).length > 0) {
            lines.push('');
            lines.push('**Responses:**');
            Object.keys(responses).sort().forEach(function(statusCode) {
              var response = responses[statusCode];
              if (typeof response !== 'object') return;
              var resDesc = response.description || 'No description';
              lines.push('- `' + statusCode + '`: ' + resDesc);
            });
          }
        });
      });
    }

    var components = schema.components || {};
    if (components) {
      var schemas = components.schemas || {};
      if (schemas && Object.keys(schemas).length > 0) {
        lines.push('');
        lines.push('# Data Models (Schemas)');

        Object.keys(schemas).slice(0, 20).forEach(function(schemaName) {
          var schemaDef = schemas[schemaName];
          if (typeof schemaDef !== 'object') return;

          lines.push('');
          lines.push('## `' + schemaName + '`');

          var desc = schemaDef.description || '';
          if (desc) lines.push('*' + desc + '*');

          var props = schemaDef.properties || {};
          if (props && Object.keys(props).length > 0) {
            lines.push('');
            lines.push('**Properties:**');
            var schemaRequired = schemaDef.required || [];
            Object.keys(props).slice(0, 10).forEach(function(propName) {
              var propDef = props[propName];
              if (typeof propDef !== 'object') return;
              var ptype = propDef.type || 'any';
              var preq = schemaRequired.indexOf(propName) >= 0 ? '[required]' : '[optional]';
              var pdesc = propDef.description || '';
              lines.push('- `' + propName + '` (' + ptype + ', ' + preq + '): ' + pdesc);
            });
          }
        });
      }
    }

    return lines.join('\n');
  }
  DocBuddy.buildOpenApiContext = buildOpenApiContext;

  // ── Build curl command from tool call arguments ───────────────────────────
  function shellEscape(val) {
    return String(val).replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`').replace(/\\/g, '\\\\').replace(/!/g, '\\!');
  }

  function buildCurlCommand(method, path, queryParams, pathParams, body) {
    var url = path;
    if (queryParams && Object.keys(queryParams).length > 0) {
      var qs = Object.keys(queryParams).map(function(k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]);
      }).join('&');
      url += '?' + qs;
    }
    var cmd = 'curl -X ' + method.toUpperCase() + " '" + shellEscape(url) + "'";
    cmd += " \\\n  -H 'Content-Type: application/json'";
    if (body && Object.keys(body).length > 0) {
      try {
        var bodyJson = JSON.stringify(body, null, 2);
        cmd += " \\\n  -d '" + shellEscape(bodyJson) + "'";
      } catch (e) {
        cmd += " \\\n  -d '{}'";
      }
    }
    return cmd;
  }
  DocBuddy.buildCurlCommand = buildCurlCommand;

  // ── Build API request tool definition for LLM tool calling ─────────────────
  function buildApiRequestTool(schema) {
    var endpoints = [];
    var methodsEnum = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    var paths = schema.paths || {};

    Object.keys(paths).forEach(function(path) {
      var pathItem = paths[path];
      if (typeof pathItem !== 'object') return;

      ['get', 'post', 'put', 'patch', 'delete'].forEach(function(method) {
        if (!pathItem[method] || typeof pathItem[method] !== 'object') return;

        var op = pathItem[method];
        var summary = op.summary || '';
        var desc = method.toUpperCase() + ' ' + path;
        if (summary) {
          desc += ' — ' + summary;
        }
        endpoints.push(desc);
      });
    });

    var endpointList = endpoints.length > 0
      ? '\n' + endpoints.map(function(e) { return '- ' + e; }).join('\n')
      : 'No endpoints found.';

    return {
      type: 'function',
      function: {
        name: 'api_request',
        description: (
          'Execute an HTTP request against the API. ' +
          'Available endpoints:' + endpointList
        ),
        parameters: {
          type: 'object',
          properties: {
            method: {
              type: 'string',
              enum: Array.from(methodsEnum).sort(),
              description: 'HTTP method'
            },
            path: {
              type: 'string',
              description: 'API endpoint path, e.g. /users/{id}'
            },
            query_params: {
              type: 'object',
              description: 'Query string parameters as key-value pairs',
              additionalProperties: true
            },
            path_params: {
              type: 'object',
              description: 'Path parameters to substitute in the URL template',
              additionalProperties: true
            },
            body: {
              type: 'object',
              description: 'JSON request body (for POST/PUT/PATCH requests)',
              additionalProperties: true
            }
          },
          required: ['method', 'path']
        }
      }
    };
  }
  DocBuddy.buildApiRequestTool = buildApiRequestTool;

  // ── Markdown parser initialization (marked.js) ────────────────────────────
  var marked = (typeof window.marked !== 'undefined') ? window.marked : null;
  function initMarked() {
    if (!marked && typeof window.marked !== 'undefined') {
      marked = window.marked;
    }
    return marked;
  }
  DocBuddy.initMarked = initMarked;

  // ── Parse Markdown safely ─────────────────────────────────────────────────
  function _escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>');
  }

  // Register DOMPurify hook to force rel="noopener noreferrer" on links
  // with target="_blank" (prevents tabnapping via window.opener) while
  // preserving any existing rel directives (e.g., "nofollow").
  var _domPurifyHooksRegistered = false;
  function _ensureDomPurifyHooks() {
    if (_domPurifyHooksRegistered || typeof DOMPurify === 'undefined') return;
    DOMPurify.addHook('afterSanitizeAttributes', function(node) {
      if (node.tagName === 'A') {
        var target = node.getAttribute('target');
        if (target && target.toLowerCase() === '_blank') {
          var existingRel = node.getAttribute('rel') || '';
          var tokens = existingRel ? existingRel.split(/\s+/) : [];
          var relSet = {};
          for (var i = 0; i < tokens.length; i++) {
            if (tokens[i]) {
              relSet[tokens[i]] = true;
            }
          }
          relSet.noopener = true;
          relSet.noreferrer = true;
          var combined = [];
          for (var key in relSet) {
            if (Object.prototype.hasOwnProperty.call(relSet, key)) {
              combined.push(key);
            }
          }
          node.setAttribute('rel', combined.join(' '));
        }
      }
    });
    _domPurifyHooksRegistered = true;
  }

  function parseMarkdown(text) {
    if (!text || typeof text !== 'string') return '';
    if (typeof DOMPurify === 'undefined') {
      console.error('DOMPurify not loaded — refusing to render markdown. Falling back to plain text.');
      return _escapeHtml(text);
    }
    _ensureDomPurifyHooks();
    try {
      if (marked) {
        var html = marked.parse(text);
        var sanitized = DOMPurify.sanitize(html, {
          ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'code', 'pre',
            'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'span', 'div', 'del', 'sup', 'sub'],
          ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'id', 'alt', 'title'],
          ALLOW_DATA_ATTR: false
        });
        if (/<script[\s>]/i.test(sanitized) || /\bon[a-z]+\s*=/i.test(sanitized)) {
          console.error('DOMPurify produced suspicious output — falling back to plain text');
          return _escapeHtml(text);
        }
        return sanitized;
      }
    } catch (e) {
      console.error('Markdown parsing error:', e);
    }
    return _escapeHtml(text);
  }
  DocBuddy.parseMarkdown = parseMarkdown;

  // ── Theme default configurations ─────────────────────────────────────────────
  var THEME_DEFINITIONS = {
    dark: {
      name: 'Dark',
      primary: '#1d4ed8',
      primaryHover: '#1e40af',
      secondary: '#2d3748',
      accent: '#718096',
      background: '#0f172a',
      panelBg: '#1f2937',
      headerBg: '#111827',
      borderColor: '#4a5568',
      textPrimary: '#f7fafc',
      textSecondary: '#cbd5e0',
      inputBg: '#1f2937',
    },
    light: {
      name: 'Light',
      primary: '#2563eb',
      primaryHover: '#1d4ed8',
      secondary: '#e2e8f0',
      accent: '#718096',
      background: '#f7fafc',
      panelBg: '#ffffff',
      headerBg: '#edf2f7',
      borderColor: '#cbd5e0',
      textPrimary: '#1a202c',
      textSecondary: '#4a5568',
      inputBg: '#f7fafc',
    }
  };
  DocBuddy.THEME_DEFINITIONS = THEME_DEFINITIONS;

  // ── Storage keys ──────────────────────────────────────────────────────────
  var THEME_STORAGE_KEY = "docbuddy-theme";
  var SETTINGS_STORAGE_KEY = "docbuddy-settings";
  var CHAT_HISTORY_KEY = "docbuddy-chat-history";
  var TOOL_SETTINGS_KEY = "docbuddy-tool-settings";
  var WORKFLOW_STORAGE_KEY = 'docbuddy-workflow';
  var AGENT_HISTORY_KEY = 'docbuddy-agent-history';

  // ── In-memory cache for OpenAPI schema ────────────────────────────────────
  DocBuddy._cachedOpenapiSchema = null;
  DocBuddy._openapiSchemaFetchPromise = null;
  DocBuddy._schemaFetchUrl = null;

  function ensureOpenapiSchemaCached(onDone) {
    var targetUrl = window.DOCBUDDY_OPENAPI_URL || "/openapi.json";
    if (DocBuddy._cachedOpenapiSchema) {
      if (DocBuddy._schemaFetchUrl === targetUrl) {
        // Cache hit — same URL, return immediately
        if (onDone) onDone(DocBuddy._cachedOpenapiSchema);
        return;
      }
      // URL changed — invalidate stale cache
      DocBuddy._cachedOpenapiSchema = null;
      DocBuddy._openapiSchemaFetchPromise = null;
    }
    if (!DocBuddy._openapiSchemaFetchPromise) {
      var fetchUrl = targetUrl;
      DocBuddy._schemaFetchUrl = fetchUrl;
      DocBuddy._openapiSchemaFetchPromise = fetch(fetchUrl)
        .then(function(res) { return res.json(); })
        .then(function(schema) {
          // Only cache if this fetch is still current (prevents race conditions)
          if (DocBuddy._schemaFetchUrl === fetchUrl) {
            DocBuddy._cachedOpenapiSchema = schema;
            DocBuddy._openapiSchemaFetchPromise = null;
          }
          return schema;
        })
        .catch(function(err) {
          if (DocBuddy._schemaFetchUrl === fetchUrl) {
            DocBuddy._openapiSchemaFetchPromise = null;
          }
          console.warn('Failed to fetch OpenAPI schema:', err);
        });
    }
    if (onDone) {
      DocBuddy._openapiSchemaFetchPromise.then(onDone).catch(function() {});
    }
  }
  DocBuddy.ensureOpenapiSchemaCached = ensureOpenapiSchemaCached;

  // ── Theme loading/saving functions ─────────────────────────────────────────
  function loadTheme() {
    try {
      var raw = localStorage.getItem(THEME_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed.theme && THEME_DEFINITIONS[parsed.theme]) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load theme from localStorage:', e);
    }
    return { theme: 'light', customColors: {} };
  }
  DocBuddy.loadTheme = loadTheme;

  function saveTheme(themeData) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themeData));
    } catch (e) {
      // ignore
    }
  }
  DocBuddy.saveTheme = saveTheme;

  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  DocBuddy.loadFromStorage = loadFromStorage;

  function saveToStorage(state) {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // ignore
    }
  }
  DocBuddy.saveToStorage = saveToStorage;

  function loadChatHistory() {
    try {
      var raw = localStorage.getItem(CHAT_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  DocBuddy.loadChatHistory = loadChatHistory;

  function saveChatHistory(messages) {
    try {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages.slice(-20)));
    } catch (e) {
      // ignore
    }
  }
  DocBuddy.saveChatHistory = saveChatHistory;

  function exportAsJson(data, filename) {
    try {
      var json = JSON.stringify(data, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename || 'export.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export:', e);
    }
  }
  DocBuddy.exportAsJson = exportAsJson;

  function loadToolSettings() {
    try {
      var raw = localStorage.getItem(TOOL_SETTINGS_KEY);
      return raw ? JSON.parse(raw) : { enableTools: false, autoExecute: false, apiKey: '' };
    } catch (e) {
      return { enableTools: false, autoExecute: false, apiKey: '' };
    }
  }
  DocBuddy.loadToolSettings = loadToolSettings;

  function saveToolSettings(settings) {
    try {
      localStorage.setItem(TOOL_SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      // ignore
    }
  }
  DocBuddy.saveToolSettings = saveToolSettings;

  // ── Workflow storage helpers ────────────────────────────────────────────────
  function loadWorkflow() {
    try {
      var data = localStorage.getItem(WORKFLOW_STORAGE_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {}
    return null;
  }
  DocBuddy.loadWorkflow = loadWorkflow;

  function saveWorkflow(workflow) {
    try {
      localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(workflow));
    } catch (e) {}
  }
  DocBuddy.saveWorkflow = saveWorkflow;

  function createDefaultBlock() {
    return {
      id: generateMessageId(),
      type: 'prompt',
      content: '',
      output: '',
      status: 'idle',
      enableTools: true
    };
  }
  DocBuddy.createDefaultBlock = createDefaultBlock;

  // ── Agent storage helpers ──────────────────────────────────────────────────
  function loadAgentHistory() {
    try {
      var raw = localStorage.getItem(AGENT_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  DocBuddy.loadAgentHistory = loadAgentHistory;

  function saveAgentHistory(messages) {
    try {
      localStorage.setItem(AGENT_HISTORY_KEY, JSON.stringify(messages.slice(-30)));
    } catch (e) {
      // ignore
    }
  }
  DocBuddy.saveAgentHistory = saveAgentHistory;

  // ── Action types ────────────────────────────────────────────────────────────
  var SET_BASE_URL = "LLM_SET_BASE_URL";
  var SET_API_KEY = "LLM_SET_API_KEY";
  var SET_MODEL_ID = "LLM_SET_MODEL_ID";
  var SET_MAX_TOKENS = "LLM_SET_MAX_TOKENS";
  var SET_TEMPERATURE = "LLM_SET_TEMPERATURE";
  var SET_CONNECTION_STATUS = "LLM_SET_CONNECTION_STATUS";
  var SET_PROVIDER = "LLM_SET_PROVIDER";
  var SET_OPENAPI_SCHEMA = "LLM_SET_OPENAPI_SCHEMA";
  var SET_THEME = "LLM_SET_THEME";
  var SET_CUSTOM_COLOR = "LLM_SET_CUSTOM_COLOR";

  // ── Default state ───────────────────────────────────────────────────────────
  var storedSettings = loadFromStorage();
  var storedTheme = loadTheme();

  document.addEventListener('DOMContentLoaded', function() {
    window.applyLLMTheme(storedTheme.theme, storedTheme.customColors);
    ensureOpenapiSchemaCached();
  });

  var DEFAULT_STATE = {
    baseUrl: storedSettings.baseUrl || "http://localhost:11434/v1",
    apiKey: storedSettings.apiKey || "",
    modelId: storedSettings.modelId || "llama3",
    maxTokens: storedSettings.maxTokens != null ? storedSettings.maxTokens : 4096,
    temperature: storedSettings.temperature != null ? storedSettings.temperature : 0.7,
    provider: storedSettings.provider || "ollama",
    connectionStatus: "disconnected",
    chatHistory: loadChatHistory(),
    lastError: "",
    theme: storedTheme.theme || "light",
    customColors: storedTheme.customColors || {},
  };
  DocBuddy.DEFAULT_STATE = DEFAULT_STATE;

  // ── Debounce utility ───────────────────────────────────────────────────────
  function debounce(fn, delay) {
    var timeoutId;
    return function () {
      var self = this;
      var args = arguments;
      clearTimeout(timeoutId);
      timeoutId = setTimeout(function () {
        fn.apply(self, args);
      }, delay);
    };
  }
  DocBuddy.debounce = debounce;

  // ── Helper to dispatch via Swagger UI's auto-generated action dispatchers ──
  function dispatchAction(system, actionName, value) {
    var sys = system && typeof system.getSystem === 'function' ? system.getSystem() : null;
    if (sys && sys.llmSettingsActions && typeof sys.llmSettingsActions[actionName] === 'function') {
      sys.llmSettingsActions[actionName](value);
    }
  }
  DocBuddy.dispatchAction = dispatchAction;

  // ── Reducer ─────────────────────────────────────────────────────────────────
  function llmSettingsReducer(state, action) {
    if (state === undefined) state = DEFAULT_STATE;
    switch (action.type) {
      case SET_BASE_URL:
        return Object.assign({}, state, { baseUrl: action.payload });
      case SET_API_KEY:
        return Object.assign({}, state, { apiKey: action.payload });
      case SET_MODEL_ID:
        return Object.assign({}, state, { modelId: action.payload });
      case SET_MAX_TOKENS:
        var val = action.payload;
        if (val === '' || val === null || val === undefined) {
          return state;
        }
        var num = Number(val);
        if (!isNaN(num)) {
          return Object.assign({}, state, { maxTokens: num });
        }
        return state;
      case SET_TEMPERATURE:
        var temp = action.payload;
        if (temp === '' || temp === null || temp === undefined) {
          return state;
        }
        var numTemp = Number(temp);
        if (!isNaN(numTemp)) {
          return Object.assign({}, state, { temperature: numTemp });
        }
        return state;
      case SET_CONNECTION_STATUS:
        return Object.assign({}, state, { connectionStatus: action.payload });
      case SET_PROVIDER:
        var provider = LLM_PROVIDERS[action.payload] || LLM_PROVIDERS.custom;
        return Object.assign({}, state, {
          provider: action.payload,
          baseUrl: provider.url
        });
      case SET_OPENAPI_SCHEMA:
        return Object.assign({}, state, { openapiSchema: action.payload });
      case SET_THEME:
        var newTheme = action.payload;
        if (!THEME_DEFINITIONS[newTheme]) {
          console.warn('Invalid theme:', newTheme, 'Using default light theme');
          newTheme = 'light';
        }
        var themeDef = THEME_DEFINITIONS[newTheme] || THEME_DEFINITIONS.light;
        var mergedColors = Object.assign({}, themeDef, state.customColors || {});
        saveTheme({ theme: newTheme, customColors: mergedColors });
        return Object.assign({}, state, { theme: newTheme, customColors: mergedColors });
      case SET_CUSTOM_COLOR:
        var colorKey = action.payload.key;
        var colorValue = action.payload.value;
        var newColors = Object.assign({}, state.customColors || {});
        newColors[colorKey] = colorValue;
        saveTheme({ theme: state.theme, customColors: newColors });
        return Object.assign({}, state, { customColors: newColors });
      default:
        return state;
    }
  }
  DocBuddy.llmSettingsReducer = llmSettingsReducer;

  // ── Actions ─────────────────────────────────────────────────────────────────
  var actions = {
    setBaseUrl: function (value) { return { type: SET_BASE_URL, payload: value }; },
    setApiKey: function (value) { return { type: SET_API_KEY, payload: value }; },
    setModelId: function (value) { return { type: SET_MODEL_ID, payload: value }; },
    setMaxTokens: function (value) { return { type: SET_MAX_TOKENS, payload: value }; },
    setTemperature: function (value) { return { type: SET_TEMPERATURE, payload: value }; },
    setConnectionStatus: function (value) { return { type: SET_CONNECTION_STATUS, payload: value }; },
    setProvider: function (value) { return { type: SET_PROVIDER, payload: value }; },
    setOpenApiSchema: function (schema) { return { type: SET_OPENAPI_SCHEMA, payload: schema }; },
    setTheme: function (value) { return { type: SET_THEME, payload: value }; },
    setCustomColor: function (value) { return { type: SET_CUSTOM_COLOR, payload: value }; },
  };
  DocBuddy.actions = actions;

  // ── Selectors ───────────────────────────────────────────────────────────────
  var selectors = {
    getBaseUrl: function (state) { return state.baseUrl; },
    getApiKey: function (state) { return state.apiKey; },
    getModelId: function (state) { return state.modelId; },
    getMaxTokens: function (state) { return state.maxTokens; },
    getTemperature: function (state) { return state.temperature; },
    getConnectionStatus: function (state) { return state.connectionStatus; },
    getProvider: function (state) { return state.provider; },
    getChatHistory: function (state) { return state.chatHistory || []; },
    getOpenApiSchema: function (state) { return state.openapiSchema; },
    getLastError: function (state) { return state.lastError; },
    getTheme: function (state) { return state.theme; },
    getCustomColors: function (state) { return state.customColors; },
  };
  DocBuddy.selectors = selectors;

  // ── Status indicator ───────────────────────────────────────────────────────
  var STATUS_EMOJI = {
    disconnected: "⚪",
    connecting: "🟡",
    connected: "🟢",
    error: "🔴",
  };
  DocBuddy.STATUS_EMOJI = STATUS_EMOJI;

  // ── Message ID counter for unique timestamps ─
  var _messageIdCounter = 0;

  function generateMessageId() {
    return Date.now() + '_' + (++_messageIdCounter);
  }
  DocBuddy.generateMessageId = generateMessageId;

  // ── Consistent copy utility function (always returns a Promise) ────────────
  function copyToClipboard(text) {
    return new Promise(function(resolve, reject) {
      if (!text || typeof text !== 'string') {
        console.warn('copyToClipboard: invalid or empty text');
        resolve(false);
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(function() {
            resolve(true);
          })
          .catch(function(err) {
            console.error('Clipboard API failed:', err);
            runFallbackCopy(text, resolve);
          });
        return;
      }
      runFallbackCopy(text, resolve);
    });

    function runFallbackCopy(text, resolve) {
      try {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
          var success = document.execCommand('copy');
          document.body.removeChild(textarea);
          if (success) {
            resolve(true);
          } else {
            console.warn('execCommand copy failed');
            resolve(false);
          }
        } catch (cmdErr) {
          console.error('execCommand error:', cmdErr);
          document.body.removeChild(textarea);
          resolve(false);
        }
      } catch (fallbackErr) {
        console.error('Fallback copy also failed:', fallbackErr);
        resolve(false);
      }
    }
  }
  DocBuddy.copyToClipboard = copyToClipboard;

  // ── System Prompt Preset Selector Component (for Settings panel) ───────────
  function createSystemPromptPresetSelector(React) {
    return function SystemPromptPresetSelector(props) {
      var config = loadSystemPromptConfig();
      var presets = config.presets || {};
      var presetKeys = Object.keys(presets);
      var selectedValue = props.value || 'api_assistant';
      var isCustom = selectedValue === 'custom';

      var displayText = '';
      if (isCustom) {
        displayText = props.customPrompt || '';
      } else {
        var preset = presets[selectedValue];
        if (preset) {
          displayText = preset.prompt || '';
        } else {
          displayText = buildDefaultSystemPrompt(null);
        }
      }

      var description = '';
      if (!isCustom && presets[selectedValue]) {
        description = presets[selectedValue].description || '';
      }

      var textareaStyle = Object.assign({}, props.inputStyle, {
        resize: "vertical",
        minHeight: "120px",
        marginTop: "8px",
        fontFamily: "'Consolas', 'Monaco', monospace",
        fontSize: "12px",
        lineHeight: "1.5",
        whiteSpace: "pre-wrap",
      });

      return React.createElement(
        "div",
        { style: { marginBottom: "12px" } },
        React.createElement("label", { style: props.labelStyle }, "System Prompt Preset"),
        React.createElement(
          "select",
          {
            value: selectedValue,
            onChange: function(e) {
              props.onChange(e.target.value);
              var stored = loadFromStorage();
              stored.systemPromptPreset = e.target.value;
              saveToStorage(stored);
            },
            style: props.inputStyle
          },
          presetKeys.length > 0 ? presetKeys.map(function(key) {
            return React.createElement("option", { key: key, value: key }, presets[key].name);
          }) : React.createElement("option", { value: "api_assistant" }, "API Assistant"),
          React.createElement("option", { value: "custom" }, "Custom...")
        ),
        description && React.createElement("div", {
          style: { color: "var(--theme-text-secondary)", fontSize: "11px", marginTop: "4px", fontStyle: "italic" }
        }, description),
        React.createElement("textarea", {
          value: displayText,
          readOnly: !isCustom,
          onChange: isCustom ? function(e) {
            props.onCustomChange(e.target.value);
            var stored = loadFromStorage();
            stored.customSystemPrompt = e.target.value;
            saveToStorage(stored);
          } : undefined,
          style: Object.assign({}, textareaStyle, !isCustom ? { opacity: 0.8, cursor: "default" } : {}),
          placeholder: isCustom ? "Enter custom system prompt..." : ""
        }),
        !isCustom && React.createElement("div", {
          style: { color: "var(--theme-text-secondary)", fontSize: "10px", marginTop: "4px" }
        }, "{openapi_context} is replaced with your API schema at send time. Select \"Custom...\" to edit.")
      );
    };
  }
  DocBuddy.createSystemPromptPresetSelector = createSystemPromptPresetSelector;

  // ── CodeBlock Component - Click-to-copy for code blocks ───────────────────
  function createCodeBlock(React) {
    return class CodeBlock extends React.Component {
      constructor(props) {
        super(props);
        this.state = {
          copied: false,
          isHovering: false
        };
        this.handleCopy = this.handleCopy.bind(this);
        this.handleMouseEnter = this.handleMouseEnter.bind(this);
        this.handleMouseLeave = this.handleMouseLeave.bind(this);
        this.handleClick = this.handleClick.bind(this);
      }

      handleCopy() {
        var text = this.props.text;
        if (!text) return;

        var self = this;
        copyToClipboard(text).then(function(copied) {
          if (copied) {
            self.setState({ copied: true });
            setTimeout(function() {
              self.setState({ copied: false });
            }, 2000);
          }
        }).catch(function(err) {
          console.error('Failed to copy:', err);
        });
      }

      handleMouseEnter() {
        this.setState({ isHovering: true });
      }

      handleMouseLeave() {
        this.setState({ isHovering: false });
      }

      handleClick(e) {
        e.stopPropagation();
        this.handleCopy();
      }

      handleTouchStart(e) {
        e.preventDefault();
        this.handleClick(e);
      }

      render() {
        var text = this.props.text;
        var language = (typeof this.props.language !== "undefined") ? this.props.language : "text";
        var messageId = this.props.messageId;
        var copied = this.state.copied;
        var isHovering = this.state.isHovering;

        return React.createElement(
          "div",
          {
            className: "llm-code-block-wrapper",
            style: {
              background: "var(--theme-input-bg)",
              border: "1px solid var(--theme-border-color)",
              borderRadius: "8px",
              overflow: "hidden",
              margin: "10px 0",
              fontFamily: "'Consolas', 'Monaco', monospace",
              fontSize: "13px",
            },
          },
          React.createElement(
            "div",
            {
              role: "button",
              "aria-label": copied ? "Copied!" : "Click to copy " + language + " code",
              tabIndex: 0,
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                background: isHovering || copied ? "var(--theme-primary)" : "var(--theme-panel-bg)",
                borderBottom: "1px solid var(--theme-border-color)",
                cursor: "pointer",
                transition: "all 0.2s ease",
              },
              onClick: this.handleClick,
              onMouseEnter: this.handleMouseEnter,
              onMouseLeave: this.handleMouseLeave,
              onTouchStart: this.handleTouchStart.bind(this),
            },
            React.createElement(
              "span",
              {
                style: {
                  color: copied ? "#f0fdf4" : "var(--theme-text-secondary)",
                  fontSize: "10px",
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: "600",
                  textTransform: "uppercase",
                }
              },
              language
            ),
            React.createElement(
              "span",
              {
                style: {
                  color: copied ? "#4ade80" : (isHovering || copied ? "#fff" : "var(--theme-text-secondary)"),
                  fontSize: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.2s ease",
                }
              },
              copied && React.createElement("span", null, "✓ "),
              copied ? "Copied!" : (isHovering ? "Click to copy" : "")
            )
          ),
          React.createElement(
            "div",
            {
              style: {
                padding: "0",
                margin: 0,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                cursor: "pointer",
              },
              onClick: this.handleClick,
              onTouchStart: this.handleTouchStart.bind(this),
            },
            React.createElement(
              "pre",
              {
                style: {
                  padding: "14px 12px",
                  margin: 0,
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  color: language === 'json' ? "#a5b4fc" : "var(--theme-text-primary)",
                  lineHeight: "1.6",
                }
              },
              React.createElement("code", null, text)
            )
          )
        );
      }
    };
  }
  DocBuddy.createCodeBlock = createCodeBlock;

  // ── Helper: map chat history to API message format ──────────────────────────
  function buildApiMessages(history) {
    return history.map(function(m) {
      var msg = { role: m.role };
      if (m.content != null) msg.content = m.content;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (!m.tool_calls && msg.content == null) msg.content = m._displayContent || '';
      return msg;
    });
  }
  DocBuddy.buildApiMessages = buildApiMessages;

  // ── CSS injection helper ───────────────────────────────────────────────────
  function injectStyles(id, css) {
    if (typeof document === 'undefined') return;

    var existing = document.getElementById(id);
    if (existing) {
      if (existing.textContent !== css) {
        existing.textContent = css;
      }
      return;
    }

    var styleEl = document.createElement('style');
    styleEl.id = id;
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }
  DocBuddy.injectStyles = injectStyles;

  // ── CSS styles for chat bubbles, avatars, and animations (theme-aware) ─────
  var chatStyles = [
    '.llm-chat-container { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }',

    '.llm-chat-message-wrapper { display: flex; width: 100%; margin-bottom: 8px; box-sizing: border-box; }',

    '.llm-chat-message { padding: 10px 14px; border-radius: 12px; max-width: 85%; position: relative; box-sizing: border-box; word-wrap: break-word; overflow-wrap: break-word; }',
    '.llm-chat-message.user { align-self: flex-end; background: var(--theme-primary); color: white; }',
    '.llm-chat-message.assistant { align-self: flex-start; background: var(--theme-secondary); color: var(--theme-text-primary); }',

    '.llm-assistant-label { font-weight: 600; color: #8b5cf6; }',

    '.llm-chat-message-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 11px; opacity: 0.9; flex-shrink: 0; }',

    '.llm-chat-message-text { font-size: 15px; line-height: 1.6; word-wrap: break-word; overflow-wrap: break-word; }',
    '.llm-chat-message-text p { margin: 8px 0; }',
    '.llm-chat-message-text p:first-child { margin-top: 4px; }',
    '.llm-chat-message-text p:last-child { margin-bottom: 4px; }',

    '.llm-streaming-indicator { color: var(--theme-accent); font-style: italic; opacity: 0.7; font-size: 13px; margin-top: 8px; }',

    '.llm-chat-message-text strong { color: var(--theme-text-primary); }',
    '.llm-chat-message-text em { font-style: italic; }',
    '.llm-chat-message-text ul { margin: 8px 0; padding-left: 24px; }',
    '.llm-chat-message-text ol { margin: 8px 0; padding-left: 24px; }',
    '.llm-chat-message-text li { margin: 4px 0; }',
    '.llm-chat-message-text blockquote { border-left: 3px solid var(--theme-accent); margin: 8px 0; padding-left: 12px; opacity: 0.9; }',
    '.llm-chat-message-text a { color: #60a5fa; text-decoration: none; }',
    '.llm-chat-message-text a:hover { text-decoration: underline; }',

    '.llm-chat-message-text pre { background: var(--theme-input-bg); border-radius: 8px; padding: 12px; overflow-x: auto; margin: 10px 0; font-family: "Consolas", "Monaco", monospace; font-size: 14px; position: relative; max-width: 100%; box-sizing: border-box; word-break: break-all; }',
    '.llm-chat-message-text code { font-family: "Consolas", "Monaco", monospace; background: rgba(0,0,0,0.15); padding: 2px 6px; border-radius: 4px; font-size: 13px; }',
    '.llm-chat-message-text pre code { background: transparent; padding: 0; }',

    '#llm-chat-messages::-webkit-scrollbar { width: 8px; }',
    '#llm-chat-messages::-webkit-scrollbar-track { background: var(--theme-panel-bg); border-radius: 4px; }',
    '#llm-chat-messages::-webkit-scrollbar-thumb { background: var(--theme-secondary); border-radius: 4px; }',
    '#llm-chat-messages::-webkit-scrollbar-thumb:hover { background: var(--theme-accent); }',

    '@keyframes typing { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }',
    '.llm-typing-indicator { display: inline-flex; align-items: center; gap: 4px; padding: 8px 12px; background: var(--theme-secondary); border-radius: 18px; font-size: 14px; margin-bottom: 8px; }',
    '.llm-typing-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--theme-text-secondary); animation: typing 1.4s infinite ease-in-out both; }',
    '.llm-typing-dot:nth-child(1) { animation-delay: -0.32s; }',
    '.llm-typing-dot:nth-child(2) { animation-delay: -0.16s; }',

    '.llm-chat-input-area { width: 100%; box-sizing: border-box; flex-shrink: 0; }',

    '.llm-chat-input-area textarea { width: 100%; box-sizing: border-box; overflow-x: hidden; word-wrap: break-word; }',

    '@media (min-width: 769px) and (max-width: 1024px) {',
    '  .llm-chat-message { max-width: 80%; }',
    '}',

    '@media (min-width: 1200px) {',
    '  .llm-chat-container { max-width: 100%; }',
    '  .llm-chat-message { max-width: 75%; }',
    '}',

    '@media (max-width: 768px) {',
    '  .llm-chat-message-wrapper { width: 100%; padding: 0 4px; margin-bottom: 6px; }',
    '  .llm-chat-message { max-width: 90%; padding: 8px 10px; }',
    '  .llm-chat-message-text { font-size: 14px; }',
    '  .llm-typing-indicator { font-size: 13px; padding: 8px 12px; }',
    '  .llm-chat-messages { padding: 6px; gap: 6px; }',
    '  .llm-chat-message-header { font-size: 10px; }',
    '  .llm-chat-message-text pre { font-size: 12px; padding: 8px; }',
    '  .llm-code-block-wrapper { font-size: 12px; }',
    '}',

    '@media (max-width: 768px) and (orientation: landscape) {',
    '  .llm-chat-container { height: calc(100dvh - 40px) !important; }',
    '}',

    '.llm-error-message {',
    '  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(220, 38, 38, 0.1));',
    '  border: 1px solid rgba(239, 68, 68, 0.3);',
    '  border-radius: 8px;',
    '  padding: 12px 14px;',
    '  margin: 4px 0;',
    '}',
    '.llm-error-title {',
    '  color: #ef4444;',
    '  font-weight: 600;',
    '  font-size: 14px;',
    '  margin-bottom: 6px;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 6px;',
    '}',
    '.llm-error-title::before {',
    '  content: "⚠️";',
    '}',
    '.llm-error-text {',
    '  color: var(--theme-text-secondary);',
    '  font-size: 13px;',
    '  line-height: 1.5;',
    '}',
    '.llm-error-actions {',
    '  margin-top: 10px;',
    '}',
    '.llm-error-action-btn {',
    '  background: var(--theme-primary);',
    '  color: white;',
    '  border: none;',
    '  border-radius: 6px;',
    '  padding: 6px 14px;',
    '  font-size: 12px;',
    '  cursor: pointer;',
    '  transition: all 0.2s ease;',
    '}',
    '.llm-error-action-btn:hover {',
    '  background: var(--theme-primary-hover);',
    '  transform: translateY(-1px);',
    '}',

    '.llm-code-block-wrapper { background: var(--theme-input-bg); border: 1px solid var(--theme-border-color); border-radius: 8px; overflow: hidden; margin: 10px 0; font-family: "Consolas", "Monaco", monospace; font-size: 13px; cursor: pointer; transition: all 0.2s ease; touch-action: manipulation; }',
    '.llm-code-block-wrapper:hover { border-color: var(--theme-accent); box-shadow: 0 2px 8px rgba(0,0,0,0.1); }',
    '.llm-code-block-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: var(--theme-panel-bg); border-bottom: 1px solid var(--theme-border-color); }',
    '.llm-code-block-language { color: var(--theme-text-secondary); font-size: 10px; font-family: "Inter", sans-serif; font-weight: 600; text-transform: uppercase; }',
    '.llm-code-block-copy-indicator { color: var(--theme-text-secondary); font-size: 12px; display: flex; align-items: center; gap: 4px; transition: all 0.2s ease; }',
    '.llm-code-block-content { padding: 14px 12px; margin: 0; overflow-x: auto; white-space: pre-wrap; word-break: break-all; line-height: 1.6; cursor: pointer; }',
    '.llm-code-block-content code { font-family: "Consolas", "Monaco", monospace; }',
    '.llm-code-block-content pre { margin: 0; padding: 0; }',
    '.llm-code-block-content.json { color: #a5b4fc; }',
    '@keyframes llm-fade-in { from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }',

  ].join('\n');

  injectStyles('docbuddy-chat-styles', chatStyles);

  // ── Theme injection function ────────────────────────────────────────────────
  var _colorRe = /^#[0-9a-fA-F]{3,8}$|^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+))?\s*\)$/;
  function _safeColor(val, fallback) { return _colorRe.test(val) ? val : fallback; }

  var applyLLMTheme = function (themeName, customColors) {
    var validatedTheme = THEME_DEFINITIONS[themeName] ? themeName : 'light';
    var themeDef = THEME_DEFINITIONS[validatedTheme];

    var finalColors = Object.assign({}, themeDef, customColors);

    var cssVars = [
      '--theme-primary: ' + _safeColor(finalColors.primary, themeDef.primary),
      '--theme-primary-hover: ' + _safeColor(finalColors.primaryHover || finalColors.primary, themeDef.primaryHover || themeDef.primary),
      '--theme-secondary: ' + _safeColor(finalColors.secondary, themeDef.secondary),
      '--theme-accent: ' + _safeColor(finalColors.accent, themeDef.accent),
      '--theme-background: ' + _safeColor(finalColors.background, themeDef.background),
      '--theme-panel-bg: ' + _safeColor(finalColors.panelBg || finalColors.secondary, themeDef.panelBg || themeDef.secondary),
      '--theme-header-bg: ' + _safeColor(finalColors.headerBg || finalColors.background, themeDef.headerBg || themeDef.background),
      '--theme-border-color: ' + _safeColor(finalColors.borderColor || finalColors.secondary, themeDef.borderColor || themeDef.secondary),
      '--theme-text-primary: ' + _safeColor(finalColors.textPrimary, themeDef.textPrimary),
      '--theme-text-secondary: ' + _safeColor(finalColors.textSecondary || '#6b7280', themeDef.textSecondary || '#6b7280'),
      '--theme-input-bg: ' + _safeColor(finalColors.inputBg || finalColors.secondary, themeDef.inputBg || themeDef.secondary),
    ].join('; ');

    var css = ':root { ' + cssVars + ' }';
    var themeStyle = document.getElementById('docbuddy-theme-styles');

    if (themeStyle) {
      if (themeStyle.textContent !== css) {
        themeStyle.textContent = css;
      }
    } else {
      themeStyle = document.createElement('style');
      themeStyle.id = 'docbuddy-theme-styles';
      themeStyle.textContent = css;
      document.head.appendChild(themeStyle);
    }
  };
  DocBuddy.applyLLMTheme = applyLLMTheme;
  window.applyLLMTheme = applyLLMTheme;

  // ── Global function to open settings tab ───────────────────────────────────
  var llmOpenSettings = function() {
    if (window.llmSwitchTab) {
      window.llmSwitchTab('settings');
    } else {
      try {
        localStorage.setItem("docbuddy-active-tab", "settings");
      } catch (e) {
        console.warn('Failed to switch to settings tab:', e);
      }
    }
  };
  DocBuddy.llmOpenSettings = llmOpenSettings;
  window.llmOpenSettings = llmOpenSettings;

  // Eagerly load system prompt config at module init (before DOMContentLoaded)
  loadSystemPromptConfig();

})();
