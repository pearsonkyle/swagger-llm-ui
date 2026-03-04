// LLM Settings Swagger UI Plugin
// Adds statePlugins.llmSettings and components.LLMSettingsPanel

(function () {
  "use strict";

  // ── System Prompt Preset Configuration (load from JSON) ───────────────────
  var SYSTEM_PROMPT_CONFIG = null;
  
  function loadSystemPromptConfig() {
    if (SYSTEM_PROMPT_CONFIG) return SYSTEM_PROMPT_CONFIG;
    
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/docbuddy-static/system-prompt-config.json', true);
      xhr.timeout = 3000;
      xhr.onload = function() {
        if (xhr.status === 200) {
          try {
            SYSTEM_PROMPT_CONFIG = JSON.parse(xhr.responseText);
            // Config loaded successfully
          } catch (e) {
            console.error('Failed to parse system-prompt-config.json:', e);
          }
        }
      };
      xhr.send();
    } catch (e) {
      console.error('Failed to load system-prompt-config.json:', e);
    }
    
    // Return default synchronously — the XHR is async so config loads on subsequent calls (intentional lazy-load)
    return {
      presets: {},
      defaultPreset: 'api_assistant'
    };
  }

  // ── Get system prompt for a preset ────────────────────────────────────────
  function getSystemPromptForPreset(presetName, openapiSchema) {
    var config = loadSystemPromptConfig();
    var preset = (config.presets || {})[presetName];
    
    if (!preset) {
      // Fallback to API Assistant preset
      var defaultConfig = config.presets || {};
      if (defaultConfig.api_assistant) {
        preset = defaultConfig.api_assistant;
      } else {
        return buildDefaultSystemPrompt(openapiSchema);
      }
    }
    
    var prompt = preset.prompt || '';
    
    // Replace {openapi_context} with actual schema
    if (prompt.includes('{openapi_context}') && openapiSchema) {
      var context = buildOpenApiContext(openapiSchema);
      prompt = prompt.replace('{openapi_context}', '\n\n' + context + '\n');
    }
    
    return prompt;
  }

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
                  // Resolve $ref to show actual schema properties
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
                      // Handle array types
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
            Object.keys(props).slice(0, 10).forEach(function(propName) {
              var propDef = props[propName];
              if (typeof propDef !== 'object') return;
              var ptype = propDef.type || 'any';
              var preq = propDef.required ? '[required]' : '[optional]';
              var pdesc = propDef.description || '';
              lines.push('- `' + propName + '` (' + ptype + ', ' + preq + '): ' + pdesc);
            });
          }
        });
      }
    }
    
    return lines.join('\n');
  }

  // ── Build curl command from tool call arguments ───────────────────────────
  // Shell-escape a value for safe embedding in single-quoted strings
  function shellEscape(val) {
    return String(val).replace(/'/g, "'\\''");
  }

  function buildCurlCommand(method, path, queryParams, pathParams, body) {
    var url = path;
    if (queryParams && Object.keys(queryParams).length > 0) {
      var qs = Object.keys(queryParams).map(function(k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]);
      }).join('&');
      url += '?' + qs;
    }
    // Use single quotes around URL to prevent shell expansion of $(), backticks, etc.
    var cmd = 'curl -X ' + method.toUpperCase() + " '" + shellEscape(url) + "'";

    // Add headers
    cmd += " \\\n  -H 'Content-Type: application/json'";

    // Add body if present
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

  // ── Markdown parser initialization (marked.js) ────────────────────────────
  // marked.js is loaded synchronously in the HTML template for consistent rendering.
  var marked = (typeof window.marked !== 'undefined') ? window.marked : null;
  function initMarked() {
    if (!marked && typeof window.marked !== 'undefined') {
      marked = window.marked;
    }
    return marked;
  }

  // ── Parse Markdown safely ─────────────────────────────────────────────────
  function _escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  function parseMarkdown(text) {
    if (!text || typeof text !== 'string') return '';

    // Refuse to render markdown without DOMPurify — fall back to escaped text
    if (typeof DOMPurify === 'undefined') {
      console.error('DOMPurify not loaded — refusing to render markdown. Falling back to plain text.');
      return _escapeHtml(text);
    }

    try {
      if (marked) {
        var html = marked.parse(text);
        var sanitized = DOMPurify.sanitize(html);
        // Defense-in-depth: reject output that still contains dangerous patterns
        if (/<script[\s>]/i.test(sanitized) || /\bon[a-z]+\s*=/i.test(sanitized)) {
          console.error('DOMPurify produced suspicious output — falling back to plain text');
          return _escapeHtml(text);
        }
        return sanitized;
      }
    } catch (e) {
      console.error('Markdown parsing error:', e);
    }

    // Fallback: plain text with line breaks, sanitized
    return _escapeHtml(text);
  }

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

  var THEME_STORAGE_KEY = "docbuddy-theme";
  var SETTINGS_STORAGE_KEY = "docbuddy-settings";
  var CHAT_HISTORY_KEY = "docbuddy-chat-history";
  var TOOL_SETTINGS_KEY = "docbuddy-tool-settings";

  // In-memory cache for the OpenAPI schema (not persisted to localStorage to avoid quota issues)
  var _cachedOpenapiSchema = null;
  // In-flight fetch promise to prevent duplicate concurrent requests
  var _openapiSchemaFetchPromise = null;

  // Shared helper: fetch and cache the OpenAPI schema exactly once at a time.
  function ensureOpenapiSchemaCached(onDone) {
    if (_cachedOpenapiSchema) {
      if (onDone) onDone(_cachedOpenapiSchema);
      return;
    }
    if (!_openapiSchemaFetchPromise) {
      _openapiSchemaFetchPromise = fetch("/openapi.json")
        .then(function(res) { return res.json(); })
        .then(function(schema) {
          _cachedOpenapiSchema = schema;
          _openapiSchemaFetchPromise = null;
          return schema;
        })
        .catch(function(err) {
          _openapiSchemaFetchPromise = null;
          console.warn('Failed to fetch OpenAPI schema:', err);
        });
    }
    if (onDone) {
      _openapiSchemaFetchPromise.then(onDone).catch(function() {});
    }
  }

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
    // Default to light theme
    return { theme: 'light', customColors: {} };
  }

  function saveTheme(themeData) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themeData));
    } catch (e) {
      // ignore
    }
  }

  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveToStorage(state) {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // ignore
    }
  }

  function loadChatHistory() {
    try {
      var raw = localStorage.getItem(CHAT_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveChatHistory(messages) {
    try {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages.slice(-20)));
    } catch (e) {
      // ignore
    }
  }

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

  function loadToolSettings() {
    try {
      var raw = localStorage.getItem(TOOL_SETTINGS_KEY);
      return raw ? JSON.parse(raw) : { enableTools: false, autoExecute: false, apiKey: '' };
    } catch (e) {
      return { enableTools: false, autoExecute: false, apiKey: '' };
    }
  }

  function saveToolSettings(settings) {
    try {
      localStorage.setItem(TOOL_SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      // ignore
    }
  }

// ── Action types ────────────────────────────────────────────────────────────
  var SET_BASE_URL = "LLM_SET_BASE_URL";
  var SET_API_KEY = "LLM_SET_API_KEY";
  var SET_MODEL_ID = "LLM_SET_MODEL_ID";
  var SET_MAX_TOKENS = "LLM_SET_MAX_TOKENS";
  var SET_TEMPERATURE = "LLM_SET_TEMPERATURE";
  var SET_CONNECTION_STATUS = "LLM_SET_CONNECTION_STATUS";
  var SET_PROVIDER = "LLM_SET_PROVIDER";
  var SET_SETTINGS_OPEN = "LLM_SET_SETTINGS_OPEN";
  var ADD_CHAT_MESSAGE = "LLM_ADD_CHAT_MESSAGE";
  var CLEAR_CHAT_HISTORY = "LLM_CLEAR_CHAT_HISTORY";
  var SET_OPENAPI_SCHEMA = "LLM_SET_OPENAPI_SCHEMA";
  var SET_THEME = "LLM_SET_THEME";
  var SET_CUSTOM_COLOR = "LLM_SET_CUSTOM_COLOR";

  // ── Default state ───────────────────────────────────────────────────────────
  var storedSettings = loadFromStorage();
  var storedTheme = loadTheme();

  document.addEventListener('DOMContentLoaded', function() {
    window.applyLLMTheme(storedTheme.theme, storedTheme.customColors);

    // Eagerly fetch the OpenAPI schema so all panels (Chat, Workflow) have
    // API context regardless of which tab is active when the page loads.
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
    settingsOpen: false,
    chatHistory: loadChatHistory(),
    lastError: "",
    theme: storedTheme.theme || "light",
    customColors: storedTheme.customColors || {},
  };

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

  // ── Helper to dispatch via Swagger UI's auto-generated action dispatchers ──
  function dispatchAction(system, actionName, value) {
    var sys = system && typeof system.getSystem === 'function' ? system.getSystem() : null;
    if (sys && sys.llmSettingsActions && typeof sys.llmSettingsActions[actionName] === 'function') {
      sys.llmSettingsActions[actionName](value);
    }
  }

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
      case SET_SETTINGS_OPEN:
        return Object.assign({}, state, { settingsOpen: action.payload });
      case ADD_CHAT_MESSAGE:
        var existingHistory = state.chatHistory;
        var newHistory = Array.isArray(existingHistory)
          ? existingHistory.concat([action.payload])
          : [action.payload];
        saveChatHistory(newHistory);
        return Object.assign({}, state, { chatHistory: newHistory });
      case CLEAR_CHAT_HISTORY:
        saveChatHistory([]);
        return Object.assign({}, state, { chatHistory: [] });
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

  // ── Actions ─────────────────────────────────────────────────────────────────
  var actions = {
    setBaseUrl: function (value) { return { type: SET_BASE_URL, payload: value }; },
    setApiKey: function (value) { return { type: SET_API_KEY, payload: value }; },
    setModelId: function (value) { return { type: SET_MODEL_ID, payload: value }; },
    setMaxTokens: function (value) { return { type: SET_MAX_TOKENS, payload: value }; },
    setTemperature: function (value) { return { type: SET_TEMPERATURE, payload: value }; },
    setConnectionStatus: function (value) { return { type: SET_CONNECTION_STATUS, payload: value }; },
    setProvider: function (value) { return { type: SET_PROVIDER, payload: value }; },
    setSettingsOpen: function (value) { return { type: SET_SETTINGS_OPEN, payload: value }; },
    addChatMessage: function (message) { return { type: ADD_CHAT_MESSAGE, payload: message }; },
    clearChatHistory: function () { return { type: CLEAR_CHAT_HISTORY }; },
    setOpenApiSchema: function (schema) { return { type: SET_OPENAPI_SCHEMA, payload: schema }; },
    setTheme: function (value) { return { type: SET_THEME, payload: value }; },
    setCustomColor: function (value) { return { type: SET_CUSTOM_COLOR, payload: value }; },
  };

  // ── Selectors ───────────────────────────────────────────────────────────────
  var selectors = {
    getBaseUrl: function (state) { return state.baseUrl; },
    getApiKey: function (state) { return state.apiKey; },
    getModelId: function (state) { return state.modelId; },
    getMaxTokens: function (state) { return state.maxTokens; },
    getTemperature: function (state) { return state.temperature; },
    getConnectionStatus: function (state) { return state.connectionStatus; },
    getProvider: function (state) { return state.provider; },
    getSettingsOpen: function (state) { return state.settingsOpen; },
    getChatHistory: function (state) { return state.chatHistory || []; },
    getOpenApiSchema: function (state) { return state.openapiSchema; },
    getLastError: function (state) { return state.lastError; },
    getTheme: function (state) { return state.theme; },
    getCustomColors: function (state) { return state.customColors; },
  };

  // ── Status indicator ───────────────────────────────────────────────────────
  var STATUS_EMOJI = {
    disconnected: "⚪",
    connecting: "🟡",
    connected: "🟢",
    error: "🔴",
  };

  // ── Message ID counter for unique timestamps ─
  var _messageIdCounter = 0;

  function generateMessageId() {
    return Date.now() + '_' + (++_messageIdCounter);
  }

  // ── Consistent copy utility function (always returns a Promise) ────────────
  function copyToClipboard(text) {
    return new Promise(function(resolve, reject) {
      // Validate input
      if (!text || typeof text !== 'string') {
        console.warn('copyToClipboard: invalid or empty text');
        resolve(false);
        return;
      }

      // Modern clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(function() {
            resolve(true);
          })
          .catch(function(err) {
            console.error('Clipboard API failed:', err);
            // Fall through to fallback
            runFallbackCopy(text, resolve);
          });
        return;
      }

      // Fallback for older browsers without clipboard API
      runFallbackCopy(text, resolve);
    });

    // Helper function for fallback copy using execCommand
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

    // ── System Prompt Preset Selector Component (for Settings panel) ───────────
  function createSystemPromptPresetSelector(React) {
    return function SystemPromptPresetSelector(props) {
      var config = loadSystemPromptConfig();
      var presets = config.presets || {};
      var presetKeys = Object.keys(presets);
      var selectedValue = props.value || 'api_assistant';
      var isCustom = selectedValue === 'custom';

      // Resolve the prompt text to display
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

      // Description for the selected preset
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
        const { text } = this.props;
        if (!text) return;

        copyToClipboard(text).then(function(copied) {
          if (copied) {
            this.setState({ copied: true });
            setTimeout(() => {
              this.setState({ copied: false });
            }, 2000);
          }
        }.bind(this)).catch(function(err) {
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
        // Prevent propagation to avoid issues with parent elements
        e.stopPropagation();
        this.handleCopy();
      }

      // Add touch support for mobile devices
      handleTouchStart(e) {
        e.preventDefault(); // Prevent ghost click
        this.handleClick(e);
      }

      render() {
        const { text, language = 'text', messageId } = this.props;
        const { copied, isHovering } = this.state;

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
          // Clickable header area
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
          // Code content area - also clickable
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

  // ── Chat panel component ───────────────────────────────────────────────────
  function ChatPanelFactory(system) {
    var React = system.React;

    return class ChatPanel extends React.Component {
      constructor(props) {
        super(props);
        this.state = {
          input: "",
          isTyping: false,
          isProcessingToolCall: false,
          chatHistory: loadChatHistory(),
          schemaLoading: false,
          copiedId: null,
          pendingToolCall: null,
          editMethod: 'GET',
          editPath: '',
          editQueryParams: '{}',
          editPathParams: '{}',
          editBody: '{}',
          toolCallResponse: null,
          toolRetryCount: 0,
          // System prompt preset state
          selectedPreset: loadFromStorage().systemPromptPreset || 'api_assistant',
          customSystemPrompt: loadFromStorage().customSystemPrompt || '',
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
        this._fetchAbortController = null;

        initMarked();
      }

      componentDidMount() {
        this.fetchOpenApiSchema();
      }

      componentWillUnmount() {
        if (this._fetchAbortController) {
          this._fetchAbortController.abort();
          this._fetchAbortController = null;
        }
        if (this._copyTimeoutId) {
          clearTimeout(this._copyTimeoutId);
          this._copyTimeoutId = null;
        }
      }

      fetchOpenApiSchema() {
        var self = this;

        // Use the shared helper to avoid duplicate in-flight requests.
        // Dispatch the schema into the Redux-like state once it is available.
        ensureOpenapiSchemaCached(function(schema) {
          if (schema) {
            dispatchAction(system, 'setOpenApiSchema', schema);
          }
          self.setState({ schemaLoading: false });
        });

        // If there is already a cached schema, the callback fires synchronously
        // inside ensureOpenapiSchemaCached, so we are done.
        if (_cachedOpenapiSchema) return;

        // Otherwise mark loading while the in-flight fetch resolves.
        if (this._fetchAbortController) {
          this._fetchAbortController.abort();
        }
        self._fetchAbortController = new AbortController();
        self.setState({ schemaLoading: true });
      }

      addMessage(msg) {
        this.setState(function (prev) {
          var history = prev.chatHistory || [];
          if (history.length > 0 && msg.role === 'assistant' && history[history.length - 1].role === 'assistant' && history[history.length - 1].messageId === msg.messageId) {
            var updated = history.slice(0, -1).concat([msg]);
            saveChatHistory(updated);
            return { chatHistory: updated };
          }
          var updated = history.concat([msg]);
          saveChatHistory(updated);
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

        // Validate URL is a relative path — reject absolute URLs to prevent
        // sending credentials (Authorization header) to external servers.
        if (!url || !/^\/[^\/\\]/.test(url)) {
          console.error('[Tool Call] Rejected non-relative path:', url);
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
        } catch (e) {}

        try {
          var queryParams = JSON.parse(s.editQueryParams || '{}');
          var queryKeys = Object.keys(queryParams);
          if (queryKeys.length > 0) {
            var qs = queryKeys.map(function(k) {
              return encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]);
            }).join('&');
            url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
          }
        } catch (e) {}

        // Prepend origin to ensure request stays on the same host
        url = window.location.origin + url;

        // Build headers - only Authorization for tool calls
        var fetchHeaders = {};
        var toolSettings = loadToolSettings();
        // Only add Authorization header if there's a non-empty API key
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
            messageId: generateMessageId()
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
          messageId: generateMessageId(),
          _displayContent: 'Tool result: Status ' + responseObj.status
        };

        var currentHistory = (self.state.chatHistory || []).slice();
        currentHistory.push(toolResultMsg);

        var apiMessages = buildApiMessages(currentHistory);

        self.addMessage(toolResultMsg);

        var streamMsgId = generateMessageId();
        var isError = responseObj.status < 200 || responseObj.status >= 300;
        self.setState({
          pendingToolCall: null,
          toolRetryCount: isError ? s.toolRetryCount + 1 : 0,
        });

        self._streamLLMResponse(apiMessages, streamMsgId, _cachedOpenapiSchema);
      }

      // ── Error classification and user-friendly messages ─────────────────────
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

      // ── Direct LLM streaming helper (no server proxy) ───────────────────────
      _streamLLMResponse(apiMessages, streamMsgId, fullSchema) {
        var self = this;
        var settings = loadFromStorage();
        var toolSettings = loadToolSettings();

        // Get system prompt from preset
        var selectedPreset = this.state.selectedPreset || 'api_assistant';
        var systemPrompt = getSystemPromptForPreset(selectedPreset, fullSchema);
        
        // When native tools are enabled, strip text-based tool calling format
        // instructions — they conflict with the native tool_calls mechanism
        if (toolSettings.enableTools) {
          systemPrompt = systemPrompt.replace(/## Tool Calling Instructions[\s\S]*$/, '').trimEnd();
          systemPrompt += "\n\nUse the `api_request` tool via native tool calling when the user asks to call an API endpoint. Do NOT output tool calls as JSON text — the system handles tool execution automatically. If a tool call returns an error, you may retry with corrected parameters (up to 3 times).";
        }

        var scrollToBottom = function() {
          var el = document.getElementById('llm-chat-messages');
          if (el) el.scrollTop = el.scrollHeight;
        };

        self.addMessage({ role: 'assistant', content: '', messageId: streamMsgId });

        self._currentCancelToken = new AbortController();
        self.setState({ isTyping: true });

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
          setTimeout(scrollToBottom, 30);
        };

        // Build messages array with system prompt
        var messages = [{ role: 'system', content: systemPrompt }].concat(apiMessages);

        // Build tools definition if enabled
        var payload = {
          messages: messages,
          model: settings.modelId || "llama3",
          max_tokens: settings.maxTokens != null && settings.maxTokens !== '' ? parseInt(settings.maxTokens) : 4096,
          temperature: settings.temperature != null && settings.temperature !== '' ? parseFloat(settings.temperature) : 0.7,
          stream: true,
        };

        if (toolSettings.enableTools && fullSchema) {
          payload.tools = [buildApiRequestTool(fullSchema)];
          payload.tool_choice = "auto";
        }

        // Build headers
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
                          saveChatHistory(updated);
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
                          saveChatHistory(history);
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
                        });
                        self._currentCancelToken = null;

                        if (toolSettings.autoExecute) {
                          setTimeout(function() { self.handleExecuteToolCall(); }, 100);
                        }
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
        var msgId = generateMessageId();
        var streamMsgId = generateMessageId();

        self._pendingToolCallMsg = null;
        self.setState({ input: "", pendingToolCall: null, toolCallResponse: null, toolRetryCount: 0 });

        var userMsg = { role: 'user', content: userInput, messageId: msgId };
        var currentHistory = self.state.chatHistory || [];
        var apiMessages = buildApiMessages(currentHistory.concat([userMsg]));

        self.addMessage(userMsg);

        self._streamLLMResponse(apiMessages, streamMsgId, _cachedOpenapiSchema);
      }

      handleBubbleClick(msgId, text) {
        if (!text || !msgId) return;
        var self = this;
        copyToClipboard(text).then(function(copied) {
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
        saveChatHistory([]);
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

        // Helper to build clean message header (no avatar)
        var renderMessageHeader = function(label, showTimestamp) {
          return React.createElement(
            "div",
            { className: "llm-chat-message-header" },
            React.createElement("span", { 
              style: { 
                fontSize: "13px", 
                fontWeight: "600", 
                color: isToolCallMsg ? "#8b5cf6" : (isTool ? "var(--theme-text-primary)" : undefined)
              } 
            }, label),
            showTimestamp && self.state.copiedId === msg.messageId
              ? React.createElement("span", { style: { fontSize: "11px", color: "#10b981", fontWeight: "500" } }, "✓ Copied")
              : null
          );
        };

        if (isToolCallMsg) {
          var toolArgs = msg._toolArgs || {};
          var tcMethod = toolArgs.method || 'GET';
          var tcPath = toolArgs.path || '';
          var tcQueryParams = toolArgs.query_params || {};
          var tcPathParams = toolArgs.path_params || {};
          var tcBody = toolArgs.body || {};
          
          // Build curl command
          var curlCommand = buildCurlCommand(tcMethod, tcPath, tcQueryParams, tcPathParams, tcBody);
          
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
                // Curl code block - click-to-copy with CodeBlock component
                React.createElement(createCodeBlock(React), {
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
                React.createElement(createCodeBlock(React), {
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
        
        var html = parseMarkdown(content);
        
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
                      exportAsJson(history, 'chat-history-' + new Date().toISOString().slice(0, 10) + '.json');
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

  // ── LLMSettingsPanel component ───────────────────────────────────────────────
  function LLMSettingsPanelFactory(system) {
    var React = system.React;

    return class LLMSettingsPanel extends React.Component {
      constructor(props) {
        super(props);
        var s = loadFromStorage();
        var ts = loadToolSettings();
        this.state = {
          baseUrl: s.baseUrl || DEFAULT_STATE.baseUrl,
          apiKey: s.apiKey || DEFAULT_STATE.apiKey,
          modelId: s.modelId || DEFAULT_STATE.modelId,
          maxTokens: s.maxTokens != null && s.maxTokens !== '' ? s.maxTokens : DEFAULT_STATE.maxTokens,
          temperature: s.temperature != null && s.temperature !== '' ? s.temperature : DEFAULT_STATE.temperature,
          provider: s.provider || DEFAULT_STATE.provider,
          theme: DEFAULT_STATE.theme,
          customColors: DEFAULT_STATE.customColors,
          connectionStatus: "disconnected",
          settingsOpen: false,
          lastError: "",
          availableModels: [],
          enableTools: ts.enableTools || false,
          autoExecute: ts.autoExecute || false,
          toolApiKey: ts.apiKey || '',
        };
        this._debouncedSave = debounce(this._saveSettings.bind(this), 300);
        this.handleTestConnection = this.handleTestConnection.bind(this);
        this.toggleOpen = this.toggleOpen.bind(this);
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
        saveToStorage(settings);
        saveToolSettings({
          enableTools: this.state.enableTools,
          autoExecute: this.state.autoExecute,
          apiKey: this.state.toolApiKey,
        });
        saveTheme({ theme: this.state.theme, customColors: this.state.customColors });
      }

      componentDidMount() {
        var stored = loadTheme();
        this.setState({ 
          theme: stored.theme || DEFAULT_STATE.theme, 
          customColors: stored.customColors || {} 
        });
        
        requestAnimationFrame(function() {
          window.applyLLMTheme(stored.theme || DEFAULT_STATE.theme, stored.customColors);
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
        saveToStorage(settings);
        self.setState({ connectionStatus: "connecting", lastError: "" });
        dispatchAction(system, 'setConnectionStatus', "connecting");

        // Build headers
        var headers = { "Content-Type": "application/json" };
        if (settings.apiKey) {
          headers["Authorization"] = "Bearer " + settings.apiKey;
        }

        var baseUrl = (settings.baseUrl || "").replace(/\/+$/, "");
        
        fetch(baseUrl + "/models", {
          method: 'GET',
          headers: headers
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
              dispatchAction(system, 'setModelId', models[0]);
            }
            self.setState(newState);
            dispatchAction(system, 'setConnectionStatus', "connected");
          })
          .catch(function (err) {
            var errorMsg = err.message || "Connection failed";
            self.setState({ connectionStatus: "error", lastError: errorMsg });
            dispatchAction(system, 'setConnectionStatus', "error");
          });
      }

      toggleOpen() {
        var newValue = !this.state.settingsOpen;
        this.setState({ settingsOpen: newValue });
        dispatchAction(system, 'setSettingsOpen', newValue);
      }

      handleProviderChange(e) {
        var value = e.target.value;
        var provider = LLM_PROVIDERS[value] || LLM_PROVIDERS.custom;
        this.setState({ provider: value, baseUrl: provider.url, availableModels: [], connectionStatus: "disconnected" });
        dispatchAction(system, 'setProvider', value);
        this._debouncedSave();
      }

      handleBaseUrlChange(e) {
        this.setState({ baseUrl: e.target.value });
        dispatchAction(system, 'setBaseUrl', e.target.value);
        this._debouncedSave();
      }

      handleApiKeyChange(e) {
        this.setState({ apiKey: e.target.value });
        dispatchAction(system, 'setApiKey', e.target.value);
        this._debouncedSave();
      }

      handleModelIdChange(e) {
        this.setState({ modelId: e.target.value });
        dispatchAction(system, 'setModelId', e.target.value);
        this._debouncedSave();
      }

      handleMaxTokensChange(e) {
        this.setState({ maxTokens: e.target.value });
        dispatchAction(system, 'setMaxTokens', e.target.value);
        this._debouncedSave();
      }

      handleTemperatureChange(e) {
        this.setState({ temperature: e.target.value });
        dispatchAction(system, 'setTemperature', e.target.value);
        this._debouncedSave();
      }

      handleThemeChange(e) {
        var value = e.target.value;
        this.setState({ theme: value });
        dispatchAction(system, 'setTheme', value);
        this._debouncedSave();
      }

      handleColorChange(colorKey, e) {
        var value = e.target.value;
        this.setState(function (prev) {
          var newColors = Object.assign({}, prev.customColors || {});
          newColors[colorKey] = value;
          return { customColors: newColors };
        });
        dispatchAction(system, 'setCustomColor', { key: colorKey, value: value });
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

        var statusEmoji = STATUS_EMOJI[s.connectionStatus] || "⚪";
        var provider = LLM_PROVIDERS[s.provider] || LLM_PROVIDERS.custom;

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

        var providerOptions = Object.keys(LLM_PROVIDERS).map(function (key) {
          return React.createElement(
            "option",
            { key: key, value: key },
            LLM_PROVIDERS[key].name
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
            Object.keys(THEME_DEFINITIONS).map(function (key) {
              return React.createElement(
                "option",
                { key: key, value: key },
                THEME_DEFINITIONS[key].name
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
              value: s.customColors.primary || THEME_DEFINITIONS[s.theme].primary,
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
              value: s.customColors.background || THEME_DEFINITIONS[s.theme].background,
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
              value: s.customColors.textPrimary || THEME_DEFINITIONS[s.theme].textPrimary,
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

        // Status indicator (moved to top of LLM Configuration section)
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

        // System Prompt Preset section - for LLM Configuration tab in Settings
        var systemPromptPresetSelector = createSystemPromptPresetSelector(React);

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
              var stored = loadFromStorage();
              stored.systemPromptPreset = val;
              saveToStorage(stored);
            }),
            customPrompt: s.customSystemPrompt || '',
            onCustomChange: (function(val) {
              self.setState({ customSystemPrompt: val });
              var stored = loadFromStorage();
              stored.customSystemPrompt = val;
              saveToStorage(stored);
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

        return React.createElement(
          "div",
          {
            id: "llm-settings-panel",
            style: {
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
              minHeight: "400px",
            },
          },
          bodyContent
        );
      }
    };
  }

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

    // CodeBlock component styles
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

  // ── Workflow storage helpers ────────────────────────────────────────────────
  var WORKFLOW_STORAGE_KEY = 'docbuddy-workflow';

  function loadWorkflow() {
    try {
      var data = localStorage.getItem(WORKFLOW_STORAGE_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {}
    return null;
  }

  function saveWorkflow(workflow) {
    try {
      localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(workflow));
    } catch (e) {}
  }

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

  // ── Workflow panel component ───────────────────────────────────────────────
  function WorkflowPanelFactory(system) {
    var React = system.React;

    return class WorkflowPanel extends React.Component {
      constructor(props) {
        super(props);
        var saved = loadWorkflow();
        // Normalize persisted blocks to clear transient fields like output/status
        var initialBlocks;
        if (saved && saved.blocks && saved.blocks.length) {
          initialBlocks = saved.blocks.map(function (block) {
            return Object.assign({}, block, {
              output: '',
              status: 'idle'
            });
          });
        } else {
          initialBlocks = [createDefaultBlock()];
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
        // Use the shared helper to ensure the OpenAPI schema is cached.
        // Covers the case where Workflow is the active tab on page load and
        // ChatPanel never mounts (so its own fetchOpenApiSchema() is never called).
        ensureOpenapiSchemaCached();
      }

      componentDidUpdate(prevProps, prevState) {
        if (prevState.blocks !== this.state.blocks && !this.state.running) {
          var persistedBlocks = this.state.blocks.map(function(b) {
            return { id: b.id, type: b.type, content: b.content, enableTools: b.enableTools !== false };
          });
          saveWorkflow({ blocks: persistedBlocks });
        }
      }

      componentWillUnmount() {
        if (this._abortController) {
          this._abortController.abort();
          this._abortController = null;
        }
      }

      handleAddBlock() {
        this.setState(function(prev) {
          return { blocks: prev.blocks.concat([createDefaultBlock()]) };
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
        // Check if any block has content
        var hasContent = self.state.blocks.some(function(b) { return b.content && b.content.trim(); });
        if (!hasContent) return;
        // Abort any existing in-flight request
        if (self._abortController) {
          self._abortController.abort();
          self._abortController = null;
        }
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
        this.setState({ running: false, aborted: true, currentBlockIdx: -1 });
      }

      handleReset() {
        if (this._abortController) {
          this._abortController.abort();
        }
        this.setState({
          blocks: [createDefaultBlock()],
          running: false,
          currentBlockIdx: -1,
          aborted: false,
        });
        saveWorkflow({ blocks: [createDefaultBlock()] });
      }

      runWorkflow() {
        var self = this;
        // Use conversationHistory as the accumulated chain of messages across all blocks
        var conversationHistory = [];

        function runBlock(idx) {
          var currentBlocks = self.state.blocks;
          if (idx >= currentBlocks.length || self.state.aborted) {
            self.setState({ running: false, currentBlockIdx: -1 });
            return;
          }

          self.setState({ currentBlockIdx: idx });

          var block = currentBlocks[idx];
          var updatedBlocks = currentBlocks.slice();
          updatedBlocks[idx] = Object.assign({}, updatedBlocks[idx], { status: 'running', output: '' });
          self.setState({ blocks: updatedBlocks });

          var settings = loadFromStorage();
          var toolSettings = loadToolSettings();
          var blockToolsEnabled = toolSettings.enableTools && (block.enableTools !== false);
          
          // FIX: Use system prompt from Settings, not hardcoded 'api_assistant'
          var selectedPreset = settings.systemPromptPreset || 'api_assistant';
          var systemPrompt = getSystemPromptForPreset(selectedPreset, _cachedOpenapiSchema);
          
          // When native tools are enabled, strip text-based tool calling format
          // instructions — they conflict with the native tool_calls mechanism
          if (blockToolsEnabled) {
            systemPrompt = systemPrompt.replace(/## Tool Calling Instructions[\s\S]*$/, '').trimEnd();
            systemPrompt += '\n\nUse the `api_request` tool via native tool calling when the user asks to call an API endpoint. Do NOT output tool calls as JSON text — the system handles tool execution automatically.';
          }
          systemPrompt += '\n\nYou are executing a multi-step workflow. Be concise. Execute each instruction precisely.';

          var currentUserMessage = { role: 'user', content: block.content || '' };
          
          // FIX: Build messages array with system prompt + accumulated conversation history
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
            var fullSchema = _cachedOpenapiSchema;
            if (fullSchema) {
              payload.tools = [buildApiRequestTool(fullSchema)];
              payload.tool_choice = 'auto';
            }
          }

          var fetchHeaders = { 'Content-Type': 'application/json' };
          if (settings.apiKey) {
            fetchHeaders['Authorization'] = 'Bearer ' + settings.apiKey;
          }

          var baseUrl = (settings.baseUrl || '').replace(/\/+$/, '');
          
          // Abort any existing in-flight request before starting a new one
          if (self._abortController && typeof self._abortController.abort === 'function') {
            try { self._abortController.abort(); } catch (e) {}
          }
          
          self._abortController = new AbortController();
          var accumulated = '';
          var accumulatedToolCalls = {};
          
          // FIX: Track messages generated during this block for proper history
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
                    // FIX: Pass lastAssistantContent to finishBlock for proper chaining
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
                          // For Mistral/Qwen compatibility, send tool call messages to executeToolCall
                          // which will build the proper message sequence for history

                          executeToolCall(toolCallsList[0], toolCallsList, function(toolOutput) {
                            var firstToolCall = toolCallsList[0];
                            
                            // Build proper message sequence:
                            // 1. User message (already added in finishBlock)
                            // 2. Assistant message with tool_calls
                            // 3. Tool result message (what we're adding here)

                            // Add assistant tool_calls message to blockMessages
                            blockMessages.push({
                              role: 'assistant',
                              content: null,
                              tool_calls: toolCallsList.map(function(tc) {
                                return { id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } };
                              })
                            });
                            
                            // Add tool result message
                            blockMessages.push({
                              role: 'tool',
                              tool_call_id: firstToolCall.id,
                              content: toolOutput
                            });

                            var tcArgs = {};
                            try { tcArgs = JSON.parse(firstToolCall.function.arguments || '{}'); } catch (e) {}
                            var curlCmd = buildCurlCommand(
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
                            
                            // Pass blockMessages to finishBlock
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

            // Validate URL is a relative path — reject absolute URLs to prevent
            // sending credentials (Authorization header) to external servers.
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

            // Prepend origin to ensure request stays on the same host
            url = window.location.origin + url;

            var toolFetchHeaders = {};
            var tSettings = loadToolSettings();
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
            
            // Respect abort signal for tool calls
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

          // Simplified finishBlock - properly builds message sequence
          function finishBlock(output, historyMessages) {
            // For Mistral compatibility, use a simple approach:
            // - If tools were used: only add the assistant's final text response (not tool_calls/.tool messages)
            // - If no tools: add the normal assistant text response
            //
            // This avoids "Not the same number of function calls and responses" errors
            // because tool_calls and tool messages are not sent to the next LLM request.
            
            if (historyMessages && historyMessages.length > 0) {
              // We had tool calls, but only add the final assistant text response
              // The tool_calls and tool results were already consumed/executed
              if (accumulated) {
                conversationHistory.push({ role: 'assistant', content: accumulated });
              }
            } else {
              // No tool calls - just normal assistant response
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
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        };

        var hasContent = s.blocks.some(function(b) { return b.content && b.content.trim(); });
        var startDisabled = s.running || !hasContent;
        var globalToolSettings = loadToolSettings();
        var globalToolsEnabled = globalToolSettings.enableTools;

        return React.createElement(
          'div',
          { style: containerStyle },
          // Toolbar
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
                exportAsJson(exportData, 'workflow-' + new Date().toISOString().slice(0, 10) + '.json');
              },
              disabled: s.running || !hasContent,
              style: Object.assign({}, btnStyle('var(--theme-secondary)'), { color: 'var(--theme-text-primary)' }, (s.running || !hasContent) ? { opacity: 0.5, cursor: 'not-allowed' } : {})
            }, '⬇ Export'),
            s.running ? React.createElement('span', {
              style: { fontSize: '12px', color: 'var(--theme-text-secondary)', marginLeft: 'auto' }
            }, 'Running block ' + (s.currentBlockIdx + 1) + ' of ' + s.blocks.length + '…') : null
          ),
          // Blocks
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
                    // Block header
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
                    // Block content textarea
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
                    // Block output
                    block.output ? React.createElement(
                      'div',
                      {
                        style: {
                          padding: '0',
                          margin: 0,
                          overflowX: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          cursor: 'pointer',
                          position: 'relative',
                        },
                        onClick: function() {
                          copyToClipboard(block.output).then(function(copied) {
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
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            color: isDone ? '#a5b4fc' : 'var(--theme-text-primary)',
                            lineHeight: '1.6',
                            fontSize: '13px',
                            fontFamily: "'Consolas', 'Monaco', monospace",
                            maxHeight: '300px',
                            overflowY: 'auto',
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

  // ── Synthesizer storage helpers ──────────────────────────────────────────────
  var SYNTH_STORAGE_KEY = 'docbuddy-synthesizer';

  function loadSynthSettings() {
    try {
      var data = localStorage.getItem(SYNTH_STORAGE_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {}
    return null;
  }

  function saveSynthSettings(settings) {
    try {
      localStorage.setItem(SYNTH_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {}
  }

  // ── Synthesizer: export JSONL (one JSON object per line) ───────────────────
  function exportAsJsonl(data, filename) {
    try {
      var lines = data.map(function(item) { return JSON.stringify(item); });
      var blob = new Blob([lines.join('\n')], { type: 'application/x-ndjson' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename || 'export.jsonl';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export JSONL:', e);
    }
  }

  // ── Robust JSON extraction from LLM output ────────────────────────────────
  function extractJsonArray(text) {
    // Strip markdown code fences (```json ... ``` or ``` ... ```)
    var stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    // Try to find a JSON array
    var match = stripped.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        var parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        // Try cleaning: remove bold markers, stray asterisks, unbalanced quotes
        var cleaned = match[0]
          .replace(/\*\*/g, '')
          .replace(/\*([^*]*)\*/g, '$1');
        try {
          var parsed2 = JSON.parse(cleaned);
          if (Array.isArray(parsed2)) return parsed2;
        } catch (e2) {
          // Last resort: extract quoted strings
          var strings = [];
          var re = /"([^"]+)"/g;
          var m;
          while ((m = re.exec(stripped)) !== null) {
            if (m[1].trim()) strings.push(m[1].trim());
          }
          if (strings.length > 0) return strings;
        }
      }
    }
    // Fallback: try parsing the whole stripped text
    try {
      var whole = JSON.parse(stripped);
      if (Array.isArray(whole)) return whole;
    } catch (e) {}
    return [];
  }

  // ── Build default topic system prompt with OpenAPI context ────────────────
  // ── Replace {openapi_context} placeholder with actual schema context ────────
  function replaceOpenapiPlaceholder(text) {
    if (!text || !text.includes('{openapi_context}')) return text;
    if (_cachedOpenapiSchema) {
      var context = buildOpenApiContext(_cachedOpenapiSchema);
      return text.replace(/\{openapi_context\}/g, context);
    }
    return text.replace(/\{openapi_context\}/g, '(OpenAPI schema not yet loaded)');
  }

  function buildDefaultTopicSystemPrompt() {
    var lines = [
      'You are a topic generation assistant that creates structured, hierarchical topic trees for API training data.',
      'Generate specific, diverse subtopics covering the full range of API capabilities, including:',
      '- Core CRUD operations for each resource type',
      '- Authentication, authorization, and permission scenarios',
      '- Filtering, sorting, pagination, and search patterns',
      '- Error handling and edge cases (invalid input, missing resources, conflicts)',
      '- Multi-step workflows involving multiple endpoints or resources',
      '- Batch operations and bulk actions where the API supports them',
      'Balance coverage across these categories — do not cluster around happy-path read operations.',
      'Focus on topics that represent real tasks an AI agent would be asked to perform.',
      'Return ONLY a JSON array of strings, no other text or formatting.',
      'Do not include markdown, bold markers, or links in the topic names.',
      'Keep topics concise (under 80 characters each).',
      '',
      '{openapi_context}'
    ];
    return replaceOpenapiPlaceholder(lines.join('\n'));
  }

  function buildDefaultGenSystemPrompt() {
    return 'You are a synthetic training data generator for fine-tuning an AI agent that uses a REST API.\n' +
      'Your goal is to produce high-quality, realistic training examples that teach the agent to:\n' +
      '- Understand natural language requests and map them to the correct API endpoints\n' +
      '- Select the right HTTP method and construct valid parameters and request bodies\n' +
      '- Interpret API responses and communicate results clearly to the user\n' +
      '- Handle errors gracefully (404s, validation errors, permission denials)\n' +
      'Use realistic user language — mix casual phrasing, technical requests, and occasionally ambiguous queries.\n' +
      'When generating tool calls, use realistic sample data that matches the field types and constraints in the schema.\n' +
      'Produce well-structured, plausible API responses that reflect real-world data for this API.\n\n' +
      '{openapi_context}';
  }

  function buildDefaultGenInstructions() {
    return 'Generate a realistic training example of a user asking an AI assistant to perform an API operation.\n' +
      'Follow these guidelines:\n' +
      '- Use natural, varied user language — some messages casual, some technical, some ambiguous\n' +
      '- Include a mix of read operations (GET) and write operations (POST/PUT/PATCH/DELETE)\n' +
      '- Vary complexity: some single-step requests, some requiring multiple parameters or chained logic\n' +
      '- Use ONLY real endpoints from the API schema — do NOT invent endpoints or paths\n' +
      '- The tool_arguments must include proper "method" and "path" fields matching real API endpoints\n' +
      '- Include realistic query_params, path_params, or body data that match the API schema';
  }

  function buildDefaultOutputSystemPrompt() {
    return 'You are a helpful API assistant. You help users interact with a REST API by making API calls on their behalf using the api_request tool.\n' +
      'Always use the api_request tool to fulfill requests — never guess or fabricate API responses.\n' +
      'After receiving a tool result, summarize the outcome clearly and concisely for the user.\n' +
      'If an operation fails, explain the error and suggest how to resolve it.\n\n' +
      '{openapi_context}';
  }

  // ── JSON repair utilities for generated sample parsing ────────────────────
  // Fixes unescaped control characters (newlines, tabs, CR) inside JSON string
  // values — the most common reason LLM-generated JSON fails JSON.parse().
  function repairJsonStrings(raw) {
    var result = '';
    var inString = false;
    var i = 0;
    while (i < raw.length) {
      var ch = raw[i];
      if (ch === '\\' && inString) {
        // Already-escaped sequence: pass both chars through unchanged
        result += ch + (raw[i + 1] || '');
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        result += ch;
        i++;
        continue;
      }
      if (inString) {
        if (ch === '\n') { result += '\\n'; }
        else if (ch === '\r') { result += '\\r'; }
        else if (ch === '\t') { result += '\\t'; }
        else { result += ch; }
      } else {
        result += ch;
      }
      i++;
    }
    return result;
  }

  // Regex-based field extractor used as a last resort when JSON repair still
  // produces invalid JSON (e.g. nested unescaped quotes in field values).
  function extractSampleFieldsRegex(raw) {
    var result = {};
    // Extract simple string fields
    var reString = /"(user_message|tool_name|assistant_response)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    var m;
    while ((m = reString.exec(raw)) !== null) {
      result[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
    // Extract tool_arguments object (handles one level of nesting)
    var argsMatch = raw.match(/"tool_arguments"\s*:\s*(\{[\s\S]*?\})\s*[,}]/);
    if (argsMatch) {
      try { result.tool_arguments = JSON.parse(argsMatch[1]); } catch (e) { /* ignore */ }
    }
    // Extract tool_result (may be a quoted string or a JSON object/array)
    var trStr = raw.match(/"tool_result"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (trStr) {
      result.tool_result = trStr[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      var trObj = raw.match(/"tool_result"\s*:\s*(\{[\s\S]*?\}|\[[\s\S]*?\])/);
      if (trObj) {
        try { result.tool_result = JSON.stringify(JSON.parse(trObj[1])); } catch (e) { result.tool_result = trObj[1]; }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  // Tries three strategies in order: direct parse → repair → regex extraction.
  function tryParseSample(content) {
    var stripped = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    var match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return null;
    var raw = match[0];
    try {
      return JSON.parse(raw);
    } catch (e1) { /* fall through */ }
    try {
      return JSON.parse(repairJsonStrings(raw));
    } catch (e2) { /* fall through */ }
    return extractSampleFieldsRegex(raw);
  }

  // ── Synthesizer panel component ───────────────────────────────────────────
  function SynthesizerPanelFactory(system) {
    var React = system.React;

    return class SynthesizerPanel extends React.Component {
      constructor(props) {
        super(props);
        var saved = loadSynthSettings() || {};
        this.state = {
          // Topic generation
          topicPrompt: saved.topicPrompt || '',
          topicDepth: saved.topicDepth != null ? saved.topicDepth : 3,
          topicDegree: saved.topicDegree != null ? saved.topicDegree : 3,
          topicSystemPrompt: saved.topicSystemPrompt || buildDefaultTopicSystemPrompt(),
          topics: saved.topics || [],
          topicGenerating: false,
          topicProgress: '',
          summarizing: false,

          // Data generation
          genSystemPrompt: saved.genSystemPrompt || buildDefaultGenSystemPrompt(),
          genInstructions: saved.genInstructions || buildDefaultGenInstructions(),
          numSamples: saved.numSamples != null ? saved.numSamples : 4,
          includeSystemMessage: saved.includeSystemMessage !== false,
          enableToolCalls: saved.enableToolCalls !== false,
          outputSystemPrompt: saved.outputSystemPrompt || buildDefaultOutputSystemPrompt(),
          generatedData: saved.generatedData || [],
          dataGenerating: false,
          dataProgress: '',

          // Preview
          inspectIdx: -1,  // -1 means no sample expanded
        };
        this._abortController = null;
        this.handleGenerateTopics = this.handleGenerateTopics.bind(this);
        this.handleSummarizeFromOpenAPI = this.handleSummarizeFromOpenAPI.bind(this);
        this.handleGenerateData = this.handleGenerateData.bind(this);
        this.handleStop = this.handleStop.bind(this);
        this.handleExportTopics = this.handleExportTopics.bind(this);
        this.handleExportData = this.handleExportData.bind(this);
        this.handleClearTopics = this.handleClearTopics.bind(this);
        this.handleClearData = this.handleClearData.bind(this);
        this.handleDeleteSample = this.handleDeleteSample.bind(this);
        this.handleInspectSample = this.handleInspectSample.bind(this);
      }

      componentDidMount() {
        var self = this;
        ensureOpenapiSchemaCached(function() {
          // Update default prompts now that schema is available for {openapi_context}
          var saved = loadSynthSettings();
          var updates = {};
          if (!saved || !saved.topicSystemPrompt) {
            updates.topicSystemPrompt = buildDefaultTopicSystemPrompt();
          }
          if (!saved || !saved.genSystemPrompt) {
            updates.genSystemPrompt = buildDefaultGenSystemPrompt();
          }
          if (!saved || !saved.outputSystemPrompt) {
            updates.outputSystemPrompt = buildDefaultOutputSystemPrompt();
          }
          if (Object.keys(updates).length > 0) {
            self.setState(updates);
          }
        });
      }

      componentDidUpdate(prevProps, prevState) {
        // Persist key settings and generated data
        if (prevState.topicPrompt !== this.state.topicPrompt ||
            prevState.topicDepth !== this.state.topicDepth ||
            prevState.topicDegree !== this.state.topicDegree ||
            prevState.topicSystemPrompt !== this.state.topicSystemPrompt ||
            prevState.genSystemPrompt !== this.state.genSystemPrompt ||
            prevState.genInstructions !== this.state.genInstructions ||
            prevState.numSamples !== this.state.numSamples ||
            prevState.includeSystemMessage !== this.state.includeSystemMessage ||
            prevState.enableToolCalls !== this.state.enableToolCalls ||
            prevState.outputSystemPrompt !== this.state.outputSystemPrompt ||
            prevState.topics !== this.state.topics ||
            prevState.generatedData !== this.state.generatedData) {
          saveSynthSettings({
            topicPrompt: this.state.topicPrompt,
            topicDepth: this.state.topicDepth,
            topicDegree: this.state.topicDegree,
            topicSystemPrompt: this.state.topicSystemPrompt,
            genSystemPrompt: this.state.genSystemPrompt,
            genInstructions: this.state.genInstructions,
            numSamples: this.state.numSamples,
            includeSystemMessage: this.state.includeSystemMessage,
            enableToolCalls: this.state.enableToolCalls,
            outputSystemPrompt: this.state.outputSystemPrompt,
            topics: this.state.topics,
            generatedData: this.state.generatedData,
          });
        }
      }

      componentWillUnmount() {
        if (this._abortController) {
          this._abortController.abort();
          this._abortController = null;
        }
      }

      // ── LLM call helper (non-streaming, returns content string) ─────────
      _callLLM(messages, signal) {
        var settings = loadFromStorage();
        var baseUrl = (settings.baseUrl || '').replace(/\/+$/, '');
        var headers = { 'Content-Type': 'application/json' };
        if (settings.apiKey) {
          headers['Authorization'] = 'Bearer ' + settings.apiKey;
        }

        var payload = {
          messages: messages,
          model: settings.modelId || 'llama3',
          max_tokens: settings.maxTokens != null && settings.maxTokens !== '' ? parseInt(settings.maxTokens) : 4096,
          temperature: settings.temperature != null && settings.temperature !== '' ? parseFloat(settings.temperature) : 0.7,
          stream: false,
        };

        return fetch(baseUrl + '/chat/completions', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload),
          signal: signal,
        })
        .then(function(res) {
          if (!res.ok) {
            return res.text().then(function(text) {
              throw new Error('HTTP ' + res.status + ': ' + text);
            });
          }
          return res.json();
        })
        .then(function(data) {
          var choice = data.choices && data.choices[0];
          if (choice && choice.message && choice.message.content) {
            return choice.message.content;
          }
          throw new Error('No content in LLM response');
        });
      }

      // ── Execute a live API call for synthesizer tool responses ─────────
      _executeApiCall(args, signal) {
        var method = (args.method || 'GET').toUpperCase();
        var url = args.path || '/';

        // Validate: must be relative path
        if (!/^\//.test(url)) {
          return Promise.resolve('Error: path must start with /');
        }

        // Substitute path params
        try {
          var pathParams = args.path_params || {};
          Object.keys(pathParams).forEach(function(key) {
            url = url.replace('{' + key + '}', encodeURIComponent(pathParams[key]));
          });
        } catch (e) {}

        // Add query params
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

        // Prepend origin
        url = window.location.origin + url;

        var headers = {};
        var tSettings = loadToolSettings();
        var toolApiKey = tSettings.apiKey && typeof tSettings.apiKey === 'string' ? tSettings.apiKey.trim() : '';
        if (toolApiKey) {
          headers['Authorization'] = 'Bearer ' + toolApiKey;
        }

        var hasBody = args.body && (method === 'POST' || method === 'PUT' || method === 'PATCH');
        if (hasBody) {
          headers['Content-Type'] = 'application/json';
        }

        var fetchOpts = { method: method, headers: headers };
        if (hasBody) {
          fetchOpts.body = JSON.stringify(args.body);
        }
        if (signal) {
          fetchOpts.signal = signal;
        }

        return fetch(url, fetchOpts)
          .then(function(res) {
            return res.text().then(function(text) {
              return text.substring(0, 4000);
            });
          })
          .catch(function(err) {
            if (err && err.name === 'AbortError') throw err;
            return 'Error: ' + err.message;
          });
      }

      // ── Summarize OpenAPI into root topic ──────────────────────────────
      handleSummarizeFromOpenAPI() {
        var self = this;
        if (!_cachedOpenapiSchema) {
          self.setState({ topicProgress: 'No OpenAPI schema available. Make sure the API is loaded.' });
          return;
        }
        self.setState({ summarizing: true, topicProgress: 'Summarizing API...' });
        var context = buildOpenApiContext(_cachedOpenapiSchema).substring(0, 3000);
        var prompt = 'Based on the following API documentation, generate a concise root topic (one sentence) ' +
          'that captures the main domain and purpose of this API. Return ONLY the topic text, nothing else.\n\n' + context;
        this._callLLM([
          { role: 'system', content: 'You summarize APIs into concise topic descriptions. Return only the topic text.' },
          { role: 'user', content: prompt }
        ])
        .then(function(content) {
          var topic = content.replace(/^["']|["']$/g, '').trim();
          self.setState({ topicPrompt: topic, summarizing: false, topicProgress: 'Root topic generated from API' });
        })
        .catch(function(err) {
          self.setState({ summarizing: false, topicProgress: 'Error summarizing: ' + err.message });
        });
      }

      // ── Topic tree generation (tree mode) ───────────────────────────────
      handleGenerateTopics() {
        var self = this;
        if (!this.state.topicPrompt.trim()) return;

        this._abortController = new AbortController();
        var signal = this._abortController.signal;
        self.setState({ topicGenerating: true, topicProgress: 'Generating top-level topics...', topics: [] });

        var depth = Math.max(1, Math.min(5, parseInt(this.state.topicDepth) || 3));
        var degree = Math.max(1, Math.min(10, parseInt(this.state.topicDegree) || 3));
        var rootPrompt = this.state.topicPrompt.trim();
        var topicSysPrompt = replaceOpenapiPlaceholder(this.state.topicSystemPrompt.trim()) || buildDefaultTopicSystemPrompt();

        // Tree structure: root -> children, each with id and children list
        var nextId = 0;
        var root = { id: nextId++, topic: rootPrompt, children: [] };
        var allNodes = [root];

        // Generate children for a single node, returning a promise
        function expandNode(node, currentDepth) {
          if (currentDepth >= depth || signal.aborted) {
            return Promise.resolve();
          }

          self.setState({
            topicProgress: 'Expanding "' + node.topic.substring(0, 40) + (node.topic.length > 40 ? '...' : '') + '" (level ' + (currentDepth + 1) + '/' + depth + ')',
            topics: allNodes.slice()
          });

          var expandPrompt = 'Generate exactly ' + degree + ' specific subtopics for: "' + node.topic + '"\n\n' +
            'The subtopics should be diverse, specific, and directly related to the parent topic.\n' +
            'Return ONLY a JSON array of ' + degree + ' strings. Example: ["subtopic1", "subtopic2", "subtopic3"]';

          return self._callLLM([
            { role: 'system', content: topicSysPrompt },
            { role: 'user', content: expandPrompt }
          ], signal)
          .then(function(content) {
            var subtopics = extractJsonArray(content);
            subtopics.slice(0, degree).forEach(function(st) {
              if (typeof st === 'string' && st.trim()) {
                var child = { id: nextId++, topic: st.trim(), children: [] };
                node.children.push(child);
                allNodes.push(child);
              }
            });
          });
        }

        // Level-by-level expansion: generate all children at current level, then recurse
        function expandLevel(nodesAtLevel, currentDepth) {
          if (currentDepth >= depth || signal.aborted || nodesAtLevel.length === 0) {
            self.setState({
              topics: allNodes.slice(),
              topicGenerating: false,
              topicProgress: 'Generated ' + allNodes.length + ' topics in tree'
            });
            return Promise.resolve();
          }

          // Expand each node at this level sequentially so we can stream progress
          var idx = 0;
          function expandNext() {
            if (idx >= nodesAtLevel.length || signal.aborted) {
              // Collect all children at this level for next round
              var nextLevel = [];
              nodesAtLevel.forEach(function(n) {
                nextLevel = nextLevel.concat(n.children);
              });
              return expandLevel(nextLevel, currentDepth + 1);
            }
            var node = nodesAtLevel[idx++];
            return expandNode(node, currentDepth).then(function() {
              self.setState({ topics: allNodes.slice() });
              return expandNext();
            });
          }
          return expandNext();
        }

        // Start: expand root's children first
        expandNode(root, 0).then(function() {
          self.setState({ topics: allNodes.slice() });
          return expandLevel(root.children, 1);
        }).catch(function(err) {
          if (err.name !== 'AbortError') {
            console.error('Topic generation error:', err);
            self.setState({
              topicProgress: 'Error: ' + err.message,
              topicGenerating: false
            });
          }
        });
      }

      // ── Training data generation (sequential, one at a time) ─────────────
      handleGenerateData() {
        var self = this;
        var topics = this.state.topics;
        if (!topics || topics.length === 0) {
          self.setState({ dataProgress: 'Generate topics first!' });
          return;
        }

        this._abortController = new AbortController();
        var signal = this._abortController.signal;
        var numSamples = Math.max(1, parseInt(this.state.numSamples) || 4);
        var includeSystem = this.state.includeSystemMessage;
        var enableToolCalls = this.state.enableToolCalls;
        var outputSystemPrompt = this.state.outputSystemPrompt.trim();
        var genInstructions = this.state.genInstructions.trim();

        // Build system prompt with OpenAPI context for generation
        var selectedPreset = loadFromStorage().systemPromptPreset || 'api_assistant';
        var apiSystemPrompt = getSystemPromptForPreset(selectedPreset, _cachedOpenapiSchema);
        // Replace {openapi_context} in all user-facing prompts at send time
        var genSysPrompt = replaceOpenapiPlaceholder(this.state.genSystemPrompt.trim()) ||
          'You are a synthetic training data generator for an AI agent. Create realistic, diverse question-answer pairs.';
        var resolvedOutputSystemPrompt = replaceOpenapiPlaceholder(outputSystemPrompt) || apiSystemPrompt;
        var resolvedGenInstructions = replaceOpenapiPlaceholder(genInstructions);

        // Build OpenAPI context for tool call generation
        var openapiContext = '';
        var toolDef = null;
        if (_cachedOpenapiSchema) {
          openapiContext = buildOpenApiContext(_cachedOpenapiSchema);
          if (enableToolCalls) {
            toolDef = buildApiRequestTool(_cachedOpenapiSchema);
          }
        }

        // Keep existing data and append new samples
        var existingData = self.state.generatedData.slice();

        self.setState({
          dataGenerating: true,
          dataProgress: 'Generating sample 1/' + numSamples + '...',
        });

        // Pick topics round-robin for the samples
        var topicList = topics.filter(function(t) { return t.topic; }).map(function(t) { return t.topic; });
        if (topicList.length === 0) topicList = ['general knowledge'];

        var completed = 0;

        function generateNext() {
          if (completed >= numSamples || signal.aborted) {
            self.setState({
              dataGenerating: false,
              dataProgress: 'Generated ' + completed + ' training example' + (completed !== 1 ? 's' : '')
            });
            return Promise.resolve();
          }

          var idx = completed;
          var topicIdx = idx % topicList.length;
          var topic = topicList[topicIdx];

          self.setState({
            dataProgress: 'Generating sample ' + (idx + 1) + '/' + numSamples + '...'
          });

          var userPrompt;
          if (enableToolCalls && toolDef) {
            userPrompt = 'Generate a realistic training example where a user asks about "' + topic + '" ' +
              'and the assistant uses the api_request tool to fulfill the request.\n\n' +
              'Available tool:\n' + JSON.stringify(toolDef, null, 2) + '\n\n' +
              (resolvedGenInstructions ? 'Instructions: ' + resolvedGenInstructions + '\n\n' : '') +
              'Return ONLY a JSON object with these fields:\n' +
              '- "user_message": the user\'s natural-language request (string)\n' +
              '- "tool_name": "api_request" (string)\n' +
              '- "tool_arguments": arguments object with "method", "path", and optionally "query_params", "path_params", "body" (object). ' +
              'Use ONLY real endpoints from the API schema above — do NOT invent endpoints.\n' +
              'Important: output must be valid JSON. Escape all special characters in string values (use \\n for newlines, \\" for quotes).';
          } else {
            userPrompt = 'Generate a training example about: "' + topic + '"\n\n' +
              (resolvedGenInstructions ? 'Instructions: ' + resolvedGenInstructions + '\n\n' : '') +
              (openapiContext ? 'API Context (for reference):\n' + openapiContext.substring(0, 2000) + '\n\n' : '') +
              'Return ONLY a JSON object with these fields:\n' +
              '- "user_message": a realistic user question (string)\n' +
              '- "assistant_response": a detailed, helpful answer (string)\n' +
              'Important: output must be valid JSON. Escape all special characters in string values (use \\n for newlines, \\" for quotes).';
          }

          return self._callLLM([
            { role: 'system', content: genSysPrompt },
            { role: 'user', content: userPrompt }
          ], signal)
          .then(function(content) {
            var parsed = tryParseSample(content);
            if (!parsed || !parsed.user_message) {
              console.warn('Failed to parse generated data:', content);
              completed++;
              return generateNext();
            }

            var toolArgs = parsed.tool_arguments || {};
            if (typeof toolArgs === 'string') {
              try { toolArgs = JSON.parse(toolArgs); } catch (e) { toolArgs = {}; }
            }

            // If tool calls enabled and we have valid arguments, execute live API call
            if (enableToolCalls && parsed.tool_name && toolArgs.method && toolArgs.path) {
              self.setState({
                dataProgress: 'Generating sample ' + (idx + 1) + '/' + numSamples + ' (calling API)...'
              });

              return self._executeApiCall(toolArgs, signal).then(function(apiResponse) {
                var callId = 'call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

                // Now ask the LLM to write a natural-language summary of the API response
                var summaryPrompt = 'The user asked: "' + (parsed.user_message || '') + '"\n' +
                  'The assistant called the api_request tool with: ' + JSON.stringify(toolArgs) + '\n' +
                  'The API responded with:\n' + apiResponse.substring(0, 3000) + '\n\n' +
                  'Write a concise, helpful natural-language response that summarizes this API result for the user. ' +
                  'Do NOT include any JSON or code — just a friendly assistant reply.';

                return self._callLLM([
                  { role: 'system', content: resolvedOutputSystemPrompt },
                  { role: 'user', content: summaryPrompt }
                ], signal).then(function(assistantResponse) {
                  var messages = [];

                  if (includeSystem) {
                    messages.push({ role: 'system', content: resolvedOutputSystemPrompt });
                  }

                  messages.push({ role: 'user', content: parsed.user_message });

                  // Assistant issues a tool call — arguments as object (not stringified)
                  messages.push({
                    role: 'assistant',
                    content: '',
                    tool_calls: [{
                      id: callId,
                      type: 'function',
                      function: {
                        name: parsed.tool_name,
                        arguments: toolArgs
                      }
                    }]
                  });

                  // Tool responds with live API result
                  messages.push({
                    role: 'tool',
                    name: parsed.tool_name,
                    tool_call_id: callId,
                    content: apiResponse
                  });

                  // Final assistant response (LLM-generated summary of real data)
                  messages.push({
                    role: 'assistant',
                    content: assistantResponse || 'Here are the results.'
                  });

                  var example = { messages: messages };
                  // Add tools definition
                  if (toolDef) {
                    example.tools = [toolDef];
                  }

                  existingData.push(example);
                  self.setState({ generatedData: existingData.slice() });
                  completed++;
                  return generateNext();
                });
              });
            } else {
              // Non-tool-call path (plain Q&A)
              var messages = [];
              if (includeSystem) {
                messages.push({ role: 'system', content: resolvedOutputSystemPrompt });
              }
              messages.push({ role: 'user', content: parsed.user_message || 'No question generated' });
              messages.push({ role: 'assistant', content: parsed.assistant_response || 'No answer generated' });

              existingData.push({ messages: messages });
              self.setState({ generatedData: existingData.slice() });
              completed++;
              return generateNext();
            }
          })
          .catch(function(err) {
            if (err.name !== 'AbortError') {
              console.warn('Generation error for sample ' + idx + ':', err);
            }
            completed++;
            return generateNext();
          });
        }

        generateNext();
      }

      handleStop() {
        if (this._abortController) {
          this._abortController.abort();
          this._abortController = null;
        }
        this.setState({ topicGenerating: false, dataGenerating: false });
      }

      handleExportTopics() {
        if (this.state.topics.length === 0) return;
        // Export with id, topic, and children ids
        var exportData = this.state.topics.map(function(node) {
          return {
            id: node.id,
            topic: node.topic,
            children: (node.children || []).map(function(c) { return c.id; })
          };
        });
        exportAsJsonl(exportData, 'synth-topics.jsonl');
      }

      handleExportData() {
        if (this.state.generatedData.length === 0) return;
        exportAsJsonl(this.state.generatedData, 'synth-training-data.jsonl');
      }

      handleClearTopics() {
        this.setState({ topics: [], topicProgress: '' });
      }

      handleClearData() {
        this.setState({ generatedData: [], dataProgress: '', inspectIdx: -1 });
      }

      handleDeleteSample(index) {
        this.setState(function(prev) {
          var newData = prev.generatedData.slice();
          newData.splice(index, 1);
          var newInspect = prev.inspectIdx;
          if (newInspect >= newData.length) newInspect = -1;
          if (newInspect === index) newInspect = -1;
          else if (newInspect > index) newInspect--;
          return { generatedData: newData, inspectIdx: newInspect };
        });
      }

      handleInspectSample(index) {
        this.setState(function(prev) {
          return { inspectIdx: prev.inspectIdx === index ? -1 : index };
        });
      }

      render() {
        var self = this;
        var s = this.state;

        var panelStyle = {
          padding: '20px',
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
          color: 'var(--theme-text-primary)',
          maxWidth: '900px',
          margin: '0 auto',
        };

        var sectionStyle = {
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid var(--theme-border-color)',
          borderRadius: '8px',
          background: 'var(--theme-panel-bg)',
        };

        var sectionTitleStyle = {
          fontSize: '14px',
          fontWeight: '600',
          marginBottom: '12px',
          color: 'var(--theme-text-primary)',
        };

        var labelStyle = {
          display: 'block',
          fontSize: '12px',
          fontWeight: '500',
          color: 'var(--theme-text-secondary)',
          marginBottom: '4px',
          marginTop: '8px',
        };

        var inputStyle = {
          width: '100%',
          padding: '8px 10px',
          border: '1px solid var(--theme-border-color)',
          borderRadius: '6px',
          background: 'var(--theme-input-bg)',
          color: 'var(--theme-text-primary)',
          fontSize: '13px',
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
          boxSizing: 'border-box',
        };

        var textareaStyle = Object.assign({}, inputStyle, {
          resize: 'vertical',
          minHeight: '60px',
          fontFamily: "'Consolas', 'Monaco', monospace",
          fontSize: '12px',
        });

        var btnStyle = {
          padding: '8px 16px',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: '500',
          marginRight: '8px',
          marginTop: '8px',
          transition: 'all 0.2s ease',
        };

        var primaryBtn = Object.assign({}, btnStyle, {
          background: 'var(--theme-primary)',
          color: '#fff',
        });

        var secondaryBtn = Object.assign({}, btnStyle, {
          background: 'var(--theme-secondary)',
          color: 'var(--theme-text-primary)',
        });

        var dangerBtn = Object.assign({}, btnStyle, {
          background: '#dc2626',
          color: '#fff',
        });

        var disabledBtn = Object.assign({}, btnStyle, {
          background: 'var(--theme-secondary)',
          color: 'var(--theme-text-secondary)',
          cursor: 'not-allowed',
          opacity: 0.6,
        });

        var inlineRow = {
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
        };

        var smallInputStyle = Object.assign({}, inputStyle, {
          width: '80px',
        });

        var progressStyle = {
          fontSize: '12px',
          color: 'var(--theme-text-secondary)',
          marginTop: '8px',
          fontStyle: 'italic',
        };

        var topicTreeStyle = {
          maxHeight: '400px',
          overflowY: 'auto',
          padding: '12px',
          border: '1px solid var(--theme-border-color)',
          borderRadius: '6px',
          background: 'var(--theme-input-bg)',
          marginTop: '8px',
          fontSize: '12px',
          fontFamily: "'Consolas', 'Monaco', monospace",
          lineHeight: '1.8',
        };

        var previewStyle = {
          maxHeight: '300px',
          overflowY: 'auto',
          padding: '12px',
          border: '1px solid var(--theme-border-color)',
          borderRadius: '6px',
          background: 'var(--theme-input-bg)',
          marginTop: '8px',
          fontSize: '12px',
          fontFamily: "'Consolas', 'Monaco', monospace",
          lineHeight: '1.6',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        };

        var checkboxRow = {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginTop: '8px',
          fontSize: '12px',
        };

        var isGenerating = s.topicGenerating || s.dataGenerating;

        // Render topic tree in hierarchical markdown format
        var topicElements = [];
        if (s.topics.length > 0) {
          // Build tree rendering from the root node (first topic)
          var renderNode = function(node, depth) {
            if (depth === 0) {
              // Root: heading
              topicElements.push(
                React.createElement('div', {
                  key: 'node-' + node.id,
                  style: { fontWeight: '700', fontSize: '14px', marginBottom: '4px' }
                }, '# ' + node.topic)
              );
            } else if (depth === 1) {
              // Level 1: section heading
              topicElements.push(
                React.createElement('div', {
                  key: 'node-' + node.id,
                  style: { fontWeight: '600', fontSize: '13px', marginTop: '8px', marginBottom: '2px' }
                }, node.topic)
              );
            } else if (depth === 2) {
              // Level 2: top-level bullet
              topicElements.push(
                React.createElement('div', {
                  key: 'node-' + node.id,
                  style: { paddingLeft: '8px' }
                }, '- ' + node.topic)
              );
            } else if (depth === 3) {
              // Level 3: indented bullet
              topicElements.push(
                React.createElement('div', {
                  key: 'node-' + node.id,
                  style: { paddingLeft: '24px' }
                }, '- ' + node.topic)
              );
            } else {
              // Deeper levels: further indented
              topicElements.push(
                React.createElement('div', {
                  key: 'node-' + node.id,
                  style: { paddingLeft: (8 + (depth - 2) * 16) + 'px' }
                }, '- ' + node.topic)
              );
            }
            // Recurse into children
            if (node.children && node.children.length > 0) {
              node.children.forEach(function(child) {
                renderNode(child, depth + 1);
              });
            }
          };
          // Find root (first node, or first with id 0)
          var rootNode = s.topics[0];
          if (rootNode) {
            renderNode(rootNode, 0);
          }
        }

        // Get user message summary for sample list
        function getSampleSummary(sample) {
          if (!sample || !sample.messages) return 'Empty sample';
          var userMsg = sample.messages.find(function(m) { return m.role === 'user'; });
          var text = userMsg ? userMsg.content : 'No user message';
          return text.length > 80 ? text.substring(0, 80) + '...' : text;
        }

        return React.createElement('div', { style: panelStyle },
          // Header
          React.createElement('div', {
            style: { marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
          },
            React.createElement('h2', {
              style: { margin: 0, fontSize: '18px', fontWeight: '600', color: 'var(--theme-text-primary)' }
            }, '🧪 Synthetic Training Data Generator'),
            React.createElement('span', {
              style: { fontSize: '11px', color: 'var(--theme-text-secondary)' }
            }, 'Uses LLM settings from Settings tab')
          ),

          // ── Section 1: Topic Generation ────────────────────────────────
          React.createElement('div', { style: sectionStyle },
            React.createElement('div', { style: sectionTitleStyle }, '🌳 Topic Generation (Tree Mode)'),

            React.createElement('label', { style: labelStyle }, 'Root Topic / Prompt'),
            React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } },
              React.createElement('input', {
                type: 'text',
                value: s.topicPrompt,
                onChange: function(e) { self.setState({ topicPrompt: e.target.value }); },
                placeholder: 'e.g. Python programming fundamentals',
                style: Object.assign({}, inputStyle, { flex: 1 }),
                disabled: isGenerating
              }),
              React.createElement('button', {
                onClick: s.summarizing ? null : self.handleSummarizeFromOpenAPI,
                disabled: isGenerating || s.summarizing,
                style: (isGenerating || s.summarizing) ? disabledBtn : secondaryBtn,
                title: 'Generate root topic from OpenAPI definition',
              }, s.summarizing ? '⏳ Summarizing...' : '📋 Summarize from API')
            ),

            React.createElement('div', { style: inlineRow },
              React.createElement('div', null,
                React.createElement('label', { style: labelStyle }, 'Depth'),
                React.createElement('input', {
                  type: 'number',
                  value: s.topicDepth,
                  min: 1, max: 5,
                  onChange: function(e) { self.setState({ topicDepth: parseInt(e.target.value) || 1 }); },
                  style: smallInputStyle,
                  disabled: isGenerating
                })
              ),
              React.createElement('div', null,
                React.createElement('label', { style: labelStyle }, 'Degree'),
                React.createElement('input', {
                  type: 'number',
                  value: s.topicDegree,
                  min: 1, max: 10,
                  onChange: function(e) { self.setState({ topicDegree: parseInt(e.target.value) || 1 }); },
                  style: smallInputStyle,
                  disabled: isGenerating
                })
              )
            ),

            React.createElement('label', { style: labelStyle }, 'Topic Generation System Prompt'),
            React.createElement('textarea', {
              value: s.topicSystemPrompt,
              onChange: function(e) { self.setState({ topicSystemPrompt: e.target.value }); },
              placeholder: 'System prompt for topic generation',
              style: Object.assign({}, textareaStyle, { minHeight: '80px' }),
              disabled: isGenerating
            }),
            React.createElement('div', {
              style: { color: 'var(--theme-text-secondary)', fontSize: '10px', marginTop: '4px' }
            }, 'Use {openapi_context} to insert your API schema. Replaced when generating data.'),

            // Buttons
            React.createElement('div', null,
              React.createElement('button', {
                onClick: s.topicGenerating ? null : self.handleGenerateTopics,
                disabled: isGenerating || !s.topicPrompt.trim(),
                style: (isGenerating || !s.topicPrompt.trim()) ? disabledBtn : primaryBtn,
              }, s.topicGenerating ? '⏳ Generating...' : '🔄 Generate Topics'),

              isGenerating && React.createElement('button', {
                onClick: self.handleStop,
                style: dangerBtn,
              }, '⏹ Stop'),

              s.topics.length > 0 && React.createElement('button', {
                onClick: self.handleExportTopics,
                style: secondaryBtn,
                disabled: isGenerating,
              }, '💾 Export Topics'),

              s.topics.length > 0 && React.createElement('button', {
                onClick: self.handleClearTopics,
                style: secondaryBtn,
                disabled: isGenerating,
              }, '🗑 Clear')
            ),

            s.topicProgress && React.createElement('div', { style: progressStyle }, s.topicProgress),

            // Topic tree display
            s.topics.length > 0 && React.createElement('div', { style: topicTreeStyle }, topicElements)
          ),

          // ── Section 2: Data Generation ─────────────────────────────────
          React.createElement('div', { style: sectionStyle },
            React.createElement('div', { style: sectionTitleStyle }, '📝 Training Data Generation'),

            React.createElement('label', { style: labelStyle }, 'Generation System Prompt'),
            React.createElement('textarea', {
              value: s.genSystemPrompt,
              onChange: function(e) { self.setState({ genSystemPrompt: e.target.value }); },
              placeholder: 'System prompt for the generation LLM',
              style: textareaStyle,
              disabled: isGenerating
            }),
            React.createElement('div', {
              style: { color: 'var(--theme-text-secondary)', fontSize: '10px', marginTop: '4px' }
            }, 'Use {openapi_context} to insert your API schema. Replaced when generating data.'),

            React.createElement('label', { style: labelStyle }, 'Generation Instructions'),
            React.createElement('textarea', {
              value: s.genInstructions,
              onChange: function(e) { self.setState({ genInstructions: e.target.value }); },
              placeholder: 'Additional instructions for training data generation',
              style: textareaStyle,
              disabled: isGenerating
            }),

            React.createElement('label', { style: labelStyle }, 'Output System Prompt (embedded in each training example)'),
            React.createElement('textarea', {
              value: s.outputSystemPrompt,
              onChange: function(e) { self.setState({ outputSystemPrompt: e.target.value }); },
              placeholder: 'System prompt included in each generated training example',
              style: textareaStyle,
              disabled: isGenerating
            }),
            React.createElement('div', {
              style: { color: 'var(--theme-text-secondary)', fontSize: '10px', marginTop: '4px' }
            }, 'Use {openapi_context} to insert your API schema. Replaced when generating data.'),

            React.createElement('div', { style: inlineRow },
              React.createElement('div', null,
                React.createElement('label', { style: labelStyle }, 'Num Samples'),
                React.createElement('input', {
                  type: 'number',
                  value: s.numSamples,
                  min: 1, max: 100,
                  onChange: function(e) { self.setState({ numSamples: parseInt(e.target.value) || 1 }); },
                  style: smallInputStyle,
                  disabled: isGenerating
                })
              )
            ),

            React.createElement('div', { style: checkboxRow },
              React.createElement('input', {
                type: 'checkbox',
                checked: s.includeSystemMessage,
                onChange: function(e) { self.setState({ includeSystemMessage: e.target.checked }); },
                id: 'synth-include-system',
                disabled: isGenerating
              }),
              React.createElement('label', { htmlFor: 'synth-include-system' }, 'Include system message in training data')
            ),

            React.createElement('div', { style: checkboxRow },
              React.createElement('input', {
                type: 'checkbox',
                checked: s.enableToolCalls,
                onChange: function(e) { self.setState({ enableToolCalls: e.target.checked }); },
                id: 'synth-enable-tools',
                disabled: isGenerating
              }),
              React.createElement('label', { htmlFor: 'synth-enable-tools' }, 'Enable tool calling in training data (uses OpenAPI endpoints)')
            ),

            // Buttons
            React.createElement('div', null,
              React.createElement('button', {
                onClick: s.dataGenerating ? null : self.handleGenerateData,
                disabled: isGenerating || s.topics.length === 0,
                style: (isGenerating || s.topics.length === 0) ? disabledBtn : primaryBtn,
              }, s.dataGenerating ? '⏳ Generating...' : '🚀 Generate Training Data'),

              isGenerating && React.createElement('button', {
                onClick: self.handleStop,
                style: dangerBtn,
              }, '⏹ Stop'),

              s.generatedData.length > 0 && React.createElement('button', {
                onClick: self.handleExportData,
                style: secondaryBtn,
                disabled: isGenerating,
              }, '💾 Export JSONL'),

              s.generatedData.length > 0 && React.createElement('button', {
                onClick: self.handleClearData,
                style: secondaryBtn,
                disabled: isGenerating,
              }, '🗑 Clear')
            ),

            s.dataProgress && React.createElement('div', { style: progressStyle }, s.dataProgress)
          ),

          // ── Section 3: Generated Samples List ──────────────────────────
          s.generatedData.length > 0 && React.createElement('div', { style: sectionStyle },
            React.createElement('div', { style: sectionTitleStyle },
              '📋 Generated Samples (' + s.generatedData.length + ')'
            ),

            React.createElement('div', {
              style: { maxHeight: '500px', overflowY: 'auto' }
            },
              s.generatedData.map(function(sample, idx) {
                var isExpanded = s.inspectIdx === idx;
                var sampleItemStyle = {
                  padding: '8px 12px',
                  border: '1px solid var(--theme-border-color)',
                  borderRadius: '6px',
                  marginBottom: '6px',
                  background: isExpanded ? 'var(--theme-input-bg)' : 'var(--theme-panel-bg)',
                  fontSize: '12px',
                };
                var sampleHeaderStyle = {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  cursor: 'pointer',
                };
                var sampleTextStyle = {
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--theme-text-primary)',
                };
                var smallBtnStyle = {
                  padding: '3px 8px',
                  border: '1px solid var(--theme-border-color)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  background: 'var(--theme-secondary)',
                  color: 'var(--theme-text-primary)',
                  flexShrink: 0,
                };
                var deleteBtnStyle = Object.assign({}, smallBtnStyle, {
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                });

                return React.createElement('div', { key: 'sample-' + idx, style: sampleItemStyle },
                  React.createElement('div', {
                    style: sampleHeaderStyle,
                    onClick: function() { self.handleInspectSample(idx); },
                  },
                    React.createElement('span', {
                      style: { color: 'var(--theme-text-secondary)', fontWeight: '500', flexShrink: 0 }
                    }, '#' + (idx + 1)),
                    React.createElement('span', { style: sampleTextStyle }, getSampleSummary(sample)),
                    React.createElement('button', {
                      onClick: function(e) { e.stopPropagation(); self.handleInspectSample(idx); },
                      style: smallBtnStyle,
                      title: isExpanded ? 'Collapse' : 'Inspect',
                    }, isExpanded ? '▲' : '🔍'),
                    React.createElement('button', {
                      onClick: function(e) { e.stopPropagation(); self.handleDeleteSample(idx); },
                      style: deleteBtnStyle,
                      title: 'Delete sample',
                      disabled: isGenerating,
                    }, '✕')
                  ),
                  isExpanded && React.createElement('div', { style: previewStyle },
                    React.createElement('code', null, JSON.stringify(sample, null, 2))
                  )
                );
              })
            )
          )
        );
      }
    };
  }

  // ── Plugin definition ───────────────────────────────────────────────────────
  window.LLMSettingsPlugin = function (system) {
    return {
      statePlugins: {
        llmSettings: {
          actions: actions,
          reducers: { llmSettings: llmSettingsReducer },
          selectors: selectors,
        },
      },
      components: {
        LLMSettingsPanel: LLMSettingsPanelFactory(system),
        ChatPanel: ChatPanelFactory(system),
        WorkflowPanel: WorkflowPanelFactory(system),
        SynthesizerPanel: SynthesizerPanelFactory(system),
      },
    };
  };

  // ── Theme injection function ────────────────────────────────────────────────
  var _colorRe = /^#[0-9a-fA-F]{3,8}$|^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+))?\s*\)$/;
  function _safeColor(val, fallback) { return _colorRe.test(val) ? val : fallback; }

  window.applyLLMTheme = function (themeName, customColors) {
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

  // ── Global function to open settings tab ───────────────────────────────────
  window.llmOpenSettings = function() {
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
})();