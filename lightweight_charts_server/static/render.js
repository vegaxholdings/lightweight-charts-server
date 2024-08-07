
/*==========*/

/*! Native Promise Only
    v0.8.1 (c) Kyle Simpson
    MIT License: http://getify.mit-license.org
*/

(function UMD(name,context,definition){
	// special form of UMD for polyfilling across environments
	context[name] = context[name] || definition();
	if (typeof module != "undefined" && module.exports) { module.exports = context[name]; }
	else if (typeof define == "function" && define.amd) { define(function $AMD$(){ return context[name]; }); }
})("Promise",typeof global != "undefined" ? global : this,function DEF(){
	/*jshint validthis:true */
	"use strict";

	var builtInProp, cycle, scheduling_queue,
		ToString = Object.prototype.toString,
		timer = (typeof setImmediate != "undefined") ?
			function timer(fn) { return setImmediate(fn); } :
			setTimeout
	;

	// dammit, IE8.
	try {
		Object.defineProperty({},"x",{});
		builtInProp = function builtInProp(obj,name,val,config) {
			return Object.defineProperty(obj,name,{
				value: val,
				writable: true,
				configurable: config !== false
			});
		};
	}
	catch (err) {
		builtInProp = function builtInProp(obj,name,val) {
			obj[name] = val;
			return obj;
		};
	}

	// Note: using a queue instead of array for efficiency
	scheduling_queue = (function Queue() {
		var first, last, item;

		function Item(fn,self) {
			this.fn = fn;
			this.self = self;
			this.next = void 0;
		}

		return {
			add: function add(fn,self) {
				item = new Item(fn,self);
				if (last) {
					last.next = item;
				}
				else {
					first = item;
				}
				last = item;
				item = void 0;
			},
			drain: function drain() {
				var f = first;
				first = last = cycle = void 0;

				while (f) {
					f.fn.call(f.self);
					f = f.next;
				}
			}
		};
	})();

	function schedule(fn,self) {
		scheduling_queue.add(fn,self);
		if (!cycle) {
			cycle = timer(scheduling_queue.drain);
		}
	}

	// promise duck typing
	function isThenable(o) {
		var _then, o_type = typeof o;

		if (o != null &&
			(
				o_type == "object" || o_type == "function"
			)
		) {
			_then = o.then;
		}
		return typeof _then == "function" ? _then : false;
	}

	function notify() {
		for (var i=0; i<this.chain.length; i++) {
			notifyIsolated(
				this,
				(this.state === 1) ? this.chain[i].success : this.chain[i].failure,
				this.chain[i]
			);
		}
		this.chain.length = 0;
	}

	// NOTE: This is a separate function to isolate
	// the `try..catch` so that other code can be
	// optimized better
	function notifyIsolated(self,cb,chain) {
		var ret, _then;
		try {
			if (cb === false) {
				chain.reject(self.msg);
			}
			else {
				if (cb === true) {
					ret = self.msg;
				}
				else {
					ret = cb.call(void 0,self.msg);
				}

				if (ret === chain.promise) {
					chain.reject(TypeError("Promise-chain cycle"));
				}
				else if (_then = isThenable(ret)) {
					_then.call(ret,chain.resolve,chain.reject);
				}
				else {
					chain.resolve(ret);
				}
			}
		}
		catch (err) {
			chain.reject(err);
		}
	}

	function resolve(msg) {
		var _then, self = this;

		// already triggered?
		if (self.triggered) { return; }

		self.triggered = true;

		// unwrap
		if (self.def) {
			self = self.def;
		}

		try {
			if (_then = isThenable(msg)) {
				schedule(function(){
					var def_wrapper = new MakeDefWrapper(self);
					try {
						_then.call(msg,
							function $resolve$(){ resolve.apply(def_wrapper,arguments); },
							function $reject$(){ reject.apply(def_wrapper,arguments); }
						);
					}
					catch (err) {
						reject.call(def_wrapper,err);
					}
				})
			}
			else {
				self.msg = msg;
				self.state = 1;
				if (self.chain.length > 0) {
					schedule(notify,self);
				}
			}
		}
		catch (err) {
			reject.call(new MakeDefWrapper(self),err);
		}
	}

	function reject(msg) {
		var self = this;

		// already triggered?
		if (self.triggered) { return; }

		self.triggered = true;

		// unwrap
		if (self.def) {
			self = self.def;
		}

		self.msg = msg;
		self.state = 2;
		if (self.chain.length > 0) {
			schedule(notify,self);
		}
	}

	function iteratePromises(Constructor,arr,resolver,rejecter) {
		for (var idx=0; idx<arr.length; idx++) {
			(function IIFE(idx){
				Constructor.resolve(arr[idx])
				.then(
					function $resolver$(msg){
						resolver(idx,msg);
					},
					rejecter
				);
			})(idx);
		}
	}

	function MakeDefWrapper(self) {
		this.def = self;
		this.triggered = false;
	}

	function MakeDef(self) {
		this.promise = self;
		this.state = 0;
		this.triggered = false;
		this.chain = [];
		this.msg = void 0;
	}

	function Promise(executor) {
		if (typeof executor != "function") {
			throw TypeError("Not a function");
		}

		if (this.__NPO__ !== 0) {
			throw TypeError("Not a promise");
		}

		// instance shadowing the inherited "brand"
		// to signal an already "initialized" promise
		this.__NPO__ = 1;

		var def = new MakeDef(this);

		this["then"] = function then(success,failure) {
			var o = {
				success: typeof success == "function" ? success : true,
				failure: typeof failure == "function" ? failure : false
			};
			// Note: `then(..)` itself can be borrowed to be used against
			// a different promise constructor for making the chained promise,
			// by substituting a different `this` binding.
			o.promise = new this.constructor(function extractChain(resolve,reject) {
				if (typeof resolve != "function" || typeof reject != "function") {
					throw TypeError("Not a function");
				}

				o.resolve = resolve;
				o.reject = reject;
			});
			def.chain.push(o);

			if (def.state !== 0) {
				schedule(notify,def);
			}

			return o.promise;
		};
		this["catch"] = function $catch$(failure) {
			return this.then(void 0,failure);
		};

		try {
			executor.call(
				void 0,
				function publicResolve(msg){
					resolve.call(def,msg);
				},
				function publicReject(msg) {
					reject.call(def,msg);
				}
			);
		}
		catch (err) {
			reject.call(def,err);
		}
	}

	var PromisePrototype = builtInProp({},"constructor",Promise,
		/*configurable=*/false
	);

	// Note: Android 4 cannot use `Object.defineProperty(..)` here
	Promise.prototype = PromisePrototype;

	// built-in "brand" to signal an "uninitialized" promise
	builtInProp(PromisePrototype,"__NPO__",0,
		/*configurable=*/false
	);

	builtInProp(Promise,"resolve",function Promise$resolve(msg) {
		var Constructor = this;

		// spec mandated checks
		// note: best "isPromise" check that's practical for now
		if (msg && typeof msg == "object" && msg.__NPO__ === 1) {
			return msg;
		}

		return new Constructor(function executor(resolve,reject){
			if (typeof resolve != "function" || typeof reject != "function") {
				throw TypeError("Not a function");
			}

			resolve(msg);
		});
	});

	builtInProp(Promise,"reject",function Promise$reject(msg) {
		return new this(function executor(resolve,reject){
			if (typeof resolve != "function" || typeof reject != "function") {
				throw TypeError("Not a function");
			}

			reject(msg);
		});
	});

	builtInProp(Promise,"all",function Promise$all(arr) {
		var Constructor = this;

		// spec mandated checks
		if (ToString.call(arr) != "[object Array]") {
			return Constructor.reject(TypeError("Not an array"));
		}
		if (arr.length === 0) {
			return Constructor.resolve([]);
		}

		return new Constructor(function executor(resolve,reject){
			if (typeof resolve != "function" || typeof reject != "function") {
				throw TypeError("Not a function");
			}

			var len = arr.length, msgs = Array(len), count = 0;

			iteratePromises(Constructor,arr,function resolver(idx,msg) {
				msgs[idx] = msg;
				if (++count === len) {
					resolve(msgs);
				}
			},reject);
		});
	});

	builtInProp(Promise,"race",function Promise$race(arr) {
		var Constructor = this;

		// spec mandated checks
		if (ToString.call(arr) != "[object Array]") {
			return Constructor.reject(TypeError("Not an array"));
		}

		return new Constructor(function executor(resolve,reject){
			if (typeof resolve != "function" || typeof reject != "function") {
				throw TypeError("Not a function");
			}

			iteratePromises(Constructor,arr,function resolver(idx,msg){
				resolve(msg);
			},reject);
		});
	});

	return Promise;
});

// IE 11 CustomEvent polyfill

(function () {
  if ( typeof window.CustomEvent === "function" ) return false; //If not IE

  function CustomEvent ( event, params ) {
    params = params || { bubbles: false, cancelable: false, detail: undefined };
    var evt = document.createEvent( 'CustomEvent' );
    evt.initCustomEvent( event, params.bubbles, params.cancelable, params.detail );
    return evt;
   }

  CustomEvent.prototype = window.Event.prototype;

  window.CustomEvent = CustomEvent;
})();

window.pywebview = {
    token: 'da25a0886acf41ec8203f391e0e796c6',
    platform: 'cocoa',
    api: {},

    _createApi: function(funcList) {
        for(var i = 0; i < funcList.length; i++) {
            var element = funcList[i];
            var funcName = element.func;
            var params = element.params;

            // Create nested structure and assign function
            var funcHierarchy = funcName.split('.');
            var functionName = funcHierarchy.pop();
            var nestedObject = funcHierarchy.reduce(function (obj, prop) {
                if (!obj[prop]) {
                    obj[prop] = {};
                }
                return obj[prop];
            }, window.pywebview.api);

            // Define the function body
            var funcBody =
                'var __id = (Math.random() + "").substring(2);' +
                'var promise = new Promise(function(resolve, reject) {' +
                '    window.pywebview._checkValue("' + funcName + '", resolve, reject, __id);' +
                '});' +
                'window.pywebview._bridge.call("' + funcName + '", arguments, __id);' +
                'return promise;';

            // Assign the new function
            nestedObject[functionName] = new Function(params, funcBody);
            window.pywebview._returnValues[funcName] = {};
        };
    },

    _bridge: {
        call: function (funcName, params, id) {
            switch(window.pywebview.platform) {
                case 'mshtml':
                case 'cef':
                case 'qtwebkit':
                case 'android-webkit':
                    return window.external.call(funcName, pywebview._stringify(params), id);
                case 'chromium':
                    // Full file path support for WebView2
                    if (params.event instanceof Event && params.event.type === 'drop' && params.event.dataTransfer.files) {
                        chrome.webview.postMessageWithAdditionalObjects('FilesDropped', params.event.dataTransfer.files);
                    }
                    return window.chrome.webview.postMessage([funcName, pywebview._stringify(params), id]);
                case 'cocoa':
                case 'gtk':
                    return window.webkit.messageHandlers.jsBridge.postMessage(pywebview._stringify({funcName, params, id}));
                case 'qtwebengine':
                    if (!window.pywebview._QWebChannel) {
                        setTimeout(function() {
                            window.pywebview._QWebChannel.objects.external.call(funcName, pywebview._stringify(params), id);
                        }, 100)
                    } else {
                        window.pywebview._QWebChannel.objects.external.call(funcName, pywebview._stringify(params), id);
                    }
                    break;
            }
        }
    },

    _checkValue: function(funcName, resolve, reject, id) {
         var check = setInterval(function () {
            var returnObj = window.pywebview._returnValues[funcName][id];
            if (returnObj) {
                var value = returnObj.value;
                var isError = returnObj.isError;

                delete window.pywebview._returnValues[funcName][id];
                clearInterval(check);

                if (isError) {
                    var pyError = JSON.parse(value);
                    var error = new Error(pyError.message);
                    error.name = pyError.name;
                    error.stack = pyError.stack;

                    reject(error);
                } else {
                    resolve(JSON.parse(value));
                }
            }
         }, 1)
    },
    _eventHandlers: {},
    _returnValues: {},
    _asyncCallback: function(result, id) {
        window.pywebview._bridge.call('pywebviewAsyncCallback', result, id)
    },
    _isPromise: function (obj) {
        return !!obj && (typeof obj === 'object' || typeof obj === 'function') && typeof obj.then === 'function';
    },

    _stringify: function stringify(obj) {
        function tryConvertToArray(obj) {
            try {
                return Array.prototype.slice.call(obj);
            } catch (e) {
                return obj;
            }
        }

        function isArrayLike(a) {
            return (
                a != null &&
                typeof(a[Symbol.iterator]) === 'function' &&
                typeof(a.length) === 'number' &&
                typeof(a) !== 'string'
            )
        }

        function serialize(obj, ancestors=[]) {
            try {
                if (obj instanceof Node) return pywebview.domJSON.toJSON(obj, { metadata: false, serialProperties: true });
                if (obj instanceof Window) return 'Window';

                var boundSerialize = serialize.bind(obj);

                if (typeof obj !== "object" || obj === null) {
                    return obj;
                }

                while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
                    ancestors.pop();
                }

                if (ancestors.includes(obj)) {
                    return "[Circular Reference]";
                }
                ancestors.push(obj);

                if (isArrayLike(obj)) {
                    obj = tryConvertToArray(obj);
                }

                if (Array.isArray(obj)) {
                    const arr = obj.map(value => boundSerialize(value, ancestors));
                    return arr;
                }

                const newObj = {};
                for (const key in obj) {
                    if (typeof obj === 'function') {
                        continue;
                    }
                    newObj[key] = boundSerialize(obj[key], ancestors);
                }
                return newObj;

            } catch (e) {
                console.error(e)
                return e.toString();
            }
        }

      var _serialize = serialize.bind(null);

      return JSON.stringify(_serialize(obj));
  },

    _getNodeId: function (element) {
        if (!element) {
            return null;
        }
        var pywebviewId = element.getAttribute('data-pywebview-id') || Math.random().toString(36).substr(2, 11);
        if (!element.hasAttribute('data-pywebview-id')) {
            element.setAttribute('data-pywebview-id', pywebviewId);
        }
        return pywebviewId;
    },

    _insertNode: function (node, parent, mode) {
        if (mode === 'LAST_CHILD') {
            parent.appendChild(node);
        } else if (mode === 'FIRST_CHILD') {
            parent.insertBefore(node, parent.firstChild);
        } else if (mode === 'BEFORE') {
            parent.parentNode.insertBefore(node, parent);
        } else if (mode === 'AFTER') {
            parent.parentNode.insertBefore(node, parent.nextSibling);
        } else if (mode === 'REPLACE') {
            parent.parentNode.replaceChild(node, parent);
        }
    },

    _processElements: function (elements) {
        var serializedElements = [];

        for (var i = 0; i < elements.length; i++) {
            var pywebviewId;
            if (elements[i] === window) {
                pywebviewId = 'window';
            } else if (elements[i] === document) {
                pywebviewId = 'document';
            } else {
                pywebviewId = window.pywebview._getNodeId(elements[i]);
            }

            var node = pywebview.domJSON.toJSON(elements[i], {
                metadata: false,
                serialProperties: true,
                deep: false
            });

            node._pywebviewId = pywebviewId;
            serializedElements.push(node);
        }

        return serializedElements;
    },
}
window.pywebview._createApi([{'func': 'callback', 'params': ['message']}, {'func': 'emit_queue.cancel_join_thread', 'params': []}, {'func': 'emit_queue.close', 'params': []}, {'func': 'emit_queue.empty', 'params': []}, {'func': 'emit_queue.full', 'params': []}, {'func': 'emit_queue.get', 'params': ['block', 'timeout']}, {'func': 'emit_queue.get_nowait', 'params': []}, {'func': 'emit_queue.join_thread', 'params': []}, {'func': 'emit_queue.put', 'params': ['obj', 'block', 'timeout']}, {'func': 'emit_queue.put_nowait', 'params': ['obj']}, {'func': 'emit_queue.qsize', 'params': []}]);

if (window.pywebview.platform == 'qtwebengine') {
    new QWebChannel(qt.webChannelTransport, function(channel) {
        window.pywebview._QWebChannel = channel;
        window.dispatchEvent(new CustomEvent('pywebviewready'));
    });
} else {
    window.dispatchEvent(new CustomEvent('pywebviewready'));
}

/**
 * domJSON.js: A simple framework for converting DOM nodes to special JSON objects, and vice versa
 *
 * @fileOverview
 * @author  Alex Zaslavsky
 * @version 0.1.2
 * @license The MIT License: Copyright (c) 2013 Alex Zaslavsky
 */



//Load the library
;(function(root, factory) {
	/* istanbul ignore next */
	if (typeof define === 'function' && define.amd) { //AMD
		define(function(){
			return factory(root);
		});
	} else if (typeof exports !== 'undefined') { //CommonJS/node.js
		var domJSON = factory(root);
		if (typeof module !== 'undefined' && module.exports) {
			module.exports = domJSON;
		}
		exports = domJSON;
	} else { //Browser global
		window.pywebview.domJSON = factory(root);
	}
})(this, function(win){
	"use strict";

	/**
	 * domJSON is a global variable to store two methods: `.toJSON()` to convert a DOM Node into a JSON object, and `.toDOM()` to turn that JSON object back into a DOM Node
	 * @namespace domJSON
	 * @global
	 */
	var domJSON = {};



	/**
	 * An object specifying a list of fields and how to filter it, or an array with the first value being an optional boolean to convey the same information
	 * @typedef {Object|Array} FilterList
	 * @property {boolean} [exclude=false] If this is set to `true`, the `filter` property will specify which fields to exclude from the result (boolean difference), not which ones to include (boolean intersection)
	 * @property {string[]} values An array of strings which specify the fields to include/exclude from some broader list
	 */



	/**
	 * Default metadata for a JSON object
	 * @private
	 * @ignore
	 */
	var metadata = {
		href: win.location.href || null,
		userAgent: window.navigator && window.navigator.userAgent ? window.navigator.userAgent : null,
		version: '0.1.2'
	};



	/**
	 * Default options for creating the JSON object
	 * @private
	 * @ignore
	 */
	var defaultsForToJSON = {
		absolutePaths: ['action', 'data', 'href', 'src'],
		//absStylePaths: ['attr', 'background', 'background-image', 'border-image', 'border-image-source', 'content', 'list-style-image', 'mask-image'], //http://stackoverflow.com/questions/27790925/what-are-all-the-css3-properties-that-accept-urls-or-uris
		attributes: true,
		computedStyle: false,
		cull: true,
		deep: true,
		domProperties: true,
		filter: false,
		htmlOnly: false,
		metadata: true,
		//parse: false,
		serialProperties: false,
		stringify: false,
		allowDangerousElements: false
	};



	/**
	 * Default options for creating a DOM node from a previously generated domJSON object
	 * @private
	 * @ignore
	 */
	var defaultsForToDOM = {
		noMeta: false,
		allowDangerousElements: false
	};



	/**
	 * A list of disallowed HTMLElement tags - there is no flexibility here, these cannot be processed by domJSON for security reasons!
	 * @private
	 * @ignore
	 */
	var banned = [
		'link',
		'script'
	]; //Consider (maybe) adding the following tags: iframe, html, audio, video, object



	/**
	 * A list of node properties that must be copied if they exist; there is no user option that will remove these
	 * @private
	 * @ignore
	 */
	var required = [
		'nodeType',
		'nodeValue',
		'tagName'
	];



	/**
	 * A list of node properties to specifically avoid simply copying; there is no user option that will allow these to be copied directly
	 * @private
	 * @ignore
	 */
	var ignored = [
		'attributes',
		'childNodes',
		'children',
		'classList',
		'dataset',
		'style'
	];



	/**
	 * A list of serialized read-only nodes to ignore; these can overwritten if the user specifies the "filter" option
	 * @private
	 * @ignore
	 */
	var serials = [
		'innerHTML',
		'innerText',
		'outerHTML',
		'outerText',
		'prefix',
		'text',
		'textContent',
		'wholeText'
	];



	/**
	 * Utility function to extend an object - useful for synchronizing user-submitted options with default values; same API as underscore extend
	 * @param {Object} [target] The object that will be extended
	 * @param {...Object} [added] Additional objects that will extend the target
	 * @private
	 * @ignore
	*/
	var extend = function(target) {
		if (!arguments.length) {
			return arguments[0] || {};
		}

		//Overwrite matching properties on the target from the added object
		for (var p in arguments[1]) {
			target[p] = arguments[1][p];
		}

		//If we have more arguments, run the function recursively
		if (arguments.length > 2) {
			var moreArgs = [target].concat(Array.prototype.slice.call(arguments, 2));
			return extend.apply( null, moreArgs);
		} else {
			return target;
		}
	};



	/**
	 * Get all of the unique values (in the order they first appeared) from one or more arrays
	 * @param {...Array} constituent An array to combine into a larger array of unique values
	 * @private
	 * @ignore
	*/
	var unique = function() {
		if (!arguments.length) {
			return [];
		}

		var all = Array.prototype.concat.apply([], arguments);
		for (var a = 0; a < all.length; a++) {
			if (all.indexOf(all[a]) < a) {
				all.splice(a, 1);
				a--;
			}
		}
		return all;
	};


	/**
	 * Make a shallow copy of an object or array
	 * @param {Object|string[]} item The object/array that will be copied
	 * @private
	 * @ignore
	*/
	var copy = function(item) {
		if (item instanceof Array) {
			return item.slice();
		} else {
			var output = {};
			for (var i in item) {
				output[i] = item[i];
			}
			return output;
		}
	};



	/**
	 * Do a boolean intersection between an array/object and a filter array
	 * @param {Object|string[]} item The object/array that will be intersected with the filter
	 * @param {boolean|string[]} filter Specifies which properties to select from the "item" (or element to keep, if "item is an array")
	 * @private
	 * @ignore
	*/
	var boolInter = function(item, filter) {
		var output;
		if (item instanceof Array) {
			output = unique(item.filter(function(val) { return filter.indexOf(val) > -1; }));
		} else {
			output = {};
			for (var f in filter) {
				if (item.hasOwnProperty(filter[f])) {
					output[filter[f]] = item[filter[f]];
				}
			}
		}
		return output;
	};



	/**
	 * Do a boolean difference between an array/object and a filter array
	 * @param {Object|string[]} item The object/array that will be differentiated with the filter
	 * @param {boolean|string[]} filter Specifies which properties to exclude from the "item" (or element to remove, if "item is an array")
	 * @private
	 * @ignore
	*/
	var boolDiff = function(item, filter) {
		var output;
		if (item instanceof Array) {
			output = unique(item.filter(function(val) { return filter.indexOf(val) === -1; }));
		} else {
			output = {};
			for (var i in item) {
				output[i] = item[i];
			}
			for (var f in filter) {
				if (output.hasOwnProperty(filter[f])) {
					delete output[filter[f]];
				}
			}
		}
		return output;
	};



	/**
	 * Determine whether we want to do a boolean intersection or difference
	 * @param {Object|string[]} item The object/array that will be differentiated with the filter
	 * @param {boolean|Array} filter Specifies which a filter behavior; if it is an array, the first value can be a boolean, indicating whether the filter array is intended for differentiation (true) or intersection (false)
	 * @private
	 * @ignore
	*/
	var boolFilter = function(item, filter) {
		//A "false" filter means we return an empty copy of item
		if (filter === false){
			return (item instanceof Array) ? [] : {};
		}

		if (filter instanceof Array && filter.length) {
			if (typeof filter[0] === 'boolean') {
				if (filter.length == 1 && typeof(filter[0]) === 'boolean') {
					//There is a filter array, but its only a single boolean
					if (filter[0] === true) {
						return copy(item);
					} else {
						return (item instanceof Array) ? [] : {};
					}
				} else {
					//The filter operation has been set explicitly; true = difference
					if (filter[0] === true) {
						return boolDiff(item, filter.slice(1));
					} else {
						return boolInter(item, filter.slice(1));
					}
				}
			} else {
				//There is no explicit operation on the filter, meaning it defaults to an intersection
				return boolInter(item, filter);
			}
		} else {
			return copy(item);
		}
	};



	/**
	 * Ensure that a FilterList type input is converted into its shorthand array form
	 * @param {boolean|FilterList} filterList The FilterList, or boolean, that will converted into the shorthand form
	 * @private
	 * @ignore
	*/
	var toShorthand = function(filterList) {
		var outputArray;
		if (typeof filterList === 'boolean') {
			return filterList;
		} else if (typeof filterList === 'object' && filterList !== null) {
			if (filterList instanceof Array) {
				return filterList.filter(function(v, i){
					return typeof v === 'string' || (i === 0 && v === true) ? true : false;
				});
			} else {
				if (!(filterList.values instanceof Array)) {
					return false;
				}

				outputArray = filterList.values.filter(function(v){
					return typeof v === 'string' ? true : false;
				});

				if (!outputArray.length) {
					return false;
				}

				if (filterList.exclude) {
					outputArray.unshift(filterList.exclude);
				}
				return outputArray;
			}
		} else if (filterList) {
			return true;
		}
		return false;
	};



	/**
	 * Check if the supplied string value is a relative path, and convert it to an absolute one if necessary; the segment processing paths leading with "../" was inspired by: http://stackoverflow.com/a/14780463/2230156
	 * @param {string} value The value that might be a relative path, and would thus need conversion
	 * @param {Object} origin The origin URL from which to which non-absolute paths are relative
	 * @private
	 * @ignore
	*/
	var toAbsolute = function(value, origin) {
		var protocol, stack, parts;
		//Sometimes, we get lucky and the DOM Node we're working on already has the absolute URL as a DOM property, so we can just use that
		/*if (node[name]){
			//We can just grab the compiled URL directly from the DOM element - easy peasy
			var sub = node[name].indexOf(value);
			if (sub !== -1) {
				return node[name];
			}
		}*/

		//Check to make sure we don't already have an absolute path, or even a dataURI
		if ( value.match(/(?:^data\:|^[\w\-\+\.]*?\:\/\/|^\/\/)/i) ){
			return value;
		}

		//If we are using the root URL, start from there
		if ( value.charAt(0) === '/' ){
			return origin + value.substr(1);
		}

		//Uh-oh, the relative path is leading with a single or double dot ("./" or "../"); things get a bit harder...
		protocol = origin.indexOf('://') > -1 ? origin.substring(0, origin.indexOf('://') + 3) : '';
		stack = (protocol.length ? origin.substring(protocol.length) : origin).split('/');
		parts = value.split('/');

		//The value after the last slash is ALWAYS considered a filename, not a directory, so always have trailing slashes on paths ending at directories!
		stack.pop();

		//Cycle through the relative path, changing the stack as we go
		for (var i=0; i<parts.length; i++) {
			if (parts[i] == '.') {
				continue;
			}
			if (parts[i] == '..') {
				if (stack.length > 1) {
					stack.pop();
				}
			} else {
				stack.push(parts[i]);
			}
		}
		return (protocol + stack.join('/'));
	};



	/**
	 * Create a copy of a node's properties, ignoring nasty things like event handles and functions
	 * @param {Node} node The DOM Node whose properties will be copied
	 * @param {Object} [opts] The options object passed down from the .toJSON() method; includes all options, even those not relevant to this function
	 * @private
	 * @ignore
	*/
	var copyJSON = function(node, opts) {
		var copy = {};
		//Copy all of the node's properties
		for (var n in node){
			//Make sure this property can be accessed
			try {
				//accessing `selectionDirection`, `selectionStart`, or `selectionEnd` throws in WebKit-based browsers
				node[n];
			} catch (e) {
				continue;
			}
			//Make sure this is an own property, and isn't a live javascript function for security reasons
			if (typeof node[n] !== 'undefined' && typeof node[n] !== 'function' && n.charAt(0).toLowerCase() === n.charAt(0)) {
				//Only allowed objects are arrays
				if ( typeof node[n] !== 'object' || node[n] instanceof Array ) {
					//If we are eliminating empty fields, make sure this value is not NULL or UNDEFINED
					if (opts.cull) {
						if (node[n] || node[n] === 0 || node[n] === false) {
							copy[n] = node[n];
						}
					} else {
						copy[n] = node[n];
					}
				}
			}
		}

		copy = boolFilter(copy, opts.domProperties);
		return copy;
	};



	/**
	 * Convert the attributes property of a DOM Node to a JSON ready object
	 * @param {Node} node The DOM Node whose attributes will be copied
	 * @param {Object} [opts] The options object passed down from the .toJSON() method; includes all options, even those not relevant to this function
	 * @private
	 * @ignore
	*/
	var attrJSON = function(node, opts) {
		var attributes = {};
		var attr = node.attributes;
		var length = attr.length;
		var absAttr;

		for (var i = 0; i < length; i++) {
			attributes[attr[i].name] = attr[i].value;
		}
		attributes = opts.attributes ? boolFilter(attributes, opts.attributes) : null;

		//Add the attributes object, converting any specified absolute paths along the way
		absAttr = boolFilter(attributes, opts.absolutePaths);
		for (var i in absAttr) {
			attributes[i] = toAbsolute(absAttr[i], opts.absoluteBase);
		}

		return attributes;
	};



	/**
	 * Grab a DOM Node's computed style
	 * @param {Node} node The DOM Node whose computed style will be calculated
	 * @param {Object} [opts] The options object passed down from the .toJSON() method; includes all options, even those not relevant to this function
	 * @private
	 * @ignore
	*/
	var styleJSON = function(node, opts) {
		//Grab the computed style
		var style, css = {};
		if (opts.computedStyle && node.style instanceof CSSStyleDeclaration) {
			style = win.getComputedStyle(node);
		} else {
			return null;
		}

		//Get the relevant properties from the computed style
		for (var k in style) {
			if ( k !== 'cssText' && !k.match(/\d/) && typeof style[k] === 'string' && style[k].length ) {
				//css.push(k+ ': ' +style[k]+ ';');
				css[k] = style[k];
			}
		}

		//Filter the style object
		return (opts.computedStyle instanceof Array) ? boolFilter(css, opts.computedStyle) : css;
	};



	/**
	 * Convert a single DOM Node into a simple object
	 * @param {Node} node The DOM Node that will be converted
	 * @param {Object} [opts] The options object passed down from the .toJSON() method; includes all options, even those not relevant to this function
	 * @private
	 * @ignore
	*/
	var toJSON = function(node, opts, depth) {
		var style, kids, kidCount, thisChild, children, copy = copyJSON(node, opts);

		//Per default, some tags are not allowed
		if (node.nodeType === 1) {
			if (!opts.allowDangerousElements) {
				for (var b in banned) {
					if (node.tagName.toLowerCase() === banned[b]) {
						return null;
					}
				}
			}
		} else if (node.nodeType === 3 && !node.nodeValue.trim()) {
			//Ignore empty buffer text nodes
			return null;
		}

		//Copy all attributes and styles, if allowed
		if (opts.attributes && node.attributes) {
			copy.attributes = attrJSON(node, opts);
		}
		if (opts.computedStyle && (style = styleJSON(node, opts))) {
			copy.style = style;
		}

		//Should we continue iterating?
		if (opts.deep === true || (typeof opts.deep === 'number' && opts.deep > depth)) {
			//We should!
			children = [];
			kids = (opts.htmlOnly) ? node.children : node.childNodes;
			kidCount = kids.length;
			for (var c = 0; c < kidCount; c++) {
				thisChild = toJSON(kids[c], opts, depth + 1);
				if (thisChild) {
					children.push(thisChild);
				}
			}

			//Append the children in the appropriate place
			copy.childNodes = children;
		}
		return copy;
	};



	/**
	 * Take a DOM node and convert it to simple object literal (or JSON string) with no circular references and no functions or events
	 * @param {Node} node The actual DOM Node which will be the starting point for parsing the DOM Tree
	 * @param {Object} [opts] A list of all method options
	 * @param {boolean} [opts.allowDangerousElements=`false`] Use `true` to parse the potentially dangerous elements `<link>` and `<script>`
	 * @param {boolean|FilterList} [opts.absolutePaths=`'action', 'data', 'href', 'src'`] Only relevant if `opts.attributes` is not `false`; use `true` to convert all relative paths found in attribute values to absolute paths, or specify a `FilterList` of keys to boolean search
	 * @param {boolean|FilterList} [opts.attributes=`true`] Use `true` to copy all attribute key-value pairs, or specify a `FilterList` of keys to boolean search
	 * @param {boolean|FilterList} [opts.computedStyle=`false`] Use `true` to parse the results of "window.getComputedStyle()" on every node (specify a `FilterList` of CSS properties to be included via boolean search); this operation is VERY costly performance-wise!
	 * @param {boolean} [opts.cull=`false`] Use `true` to ignore empty element properties
	 * @param {boolean|number} [opts.deep=`true`] Use `true` to iterate and copy all childNodes, or an INTEGER indicating how many levels down the DOM tree to iterate
	 * @param {boolean|FilterList} [opts.domProperties=true] 'false' means only 'tagName', 'nodeType', and 'nodeValue' properties will be copied, while a `FilterList` can specify DOM properties to include or exclude in the output (except for ones which serialize the DOM Node, which are handled separately by `opts.serialProperties`)
	 * @param {boolean} [opts.htmlOnly=`false`] Use `true` to only iterate through childNodes where nodeType = 1 (aka, instances of HTMLElement); irrelevant if `opts.deep` is `true`
	 * @param {boolean} [opts.metadata=`false`] Output a special object of the domJSON class, which includes metadata about this operation
	 * @todo {boolean|FilterList} [opts.parse=`false`] a `FilterList` of properties that are DOM nodes, but will still be copied **PLANNED**
	 * @param {boolean|FilterList} [opts.serialProperties=`true`] Use `true` to ignore the properties that store a serialized version of this DOM Node (ex: outerHTML, innerText, etc), or specify a `FilterList` of serial properties (no boolean search!)
	 * @param {boolean} [opts.stringify=`false`] Output a JSON string, or just a JSON-ready javascript object?
	 * @return {Object|string} A JSON-friendly object, or JSON string, of the DOM node -> JSON conversion output
	 * @method
	 * @memberof domJSON
	*/
	domJSON.toJSON = function(node, opts) {
		var copy, keys = [], options = {}, output = {};
		var timer = new Date().getTime();
		var requiring = required.slice();
		var ignoring = ignored.slice();

		//Update the default options w/ the user's custom settings
		options = extend({}, defaultsForToJSON, opts);

		//Convert all options that accept FilterList type inputs into the shorthand notation
		options.absolutePaths = toShorthand(options.absolutePaths);
		options.attributes = toShorthand(options.attributes);
		options.computedStyle = toShorthand(options.computedStyle);
		options.domProperties = toShorthand(options.domProperties);
		options.serialProperties = toShorthand(options.serialProperties);

		//Make sure there is a base URL for absolute path conversions
		options.absoluteBase = win.location.origin + '/';

		//Make lists of which DOM properties to skip and/or which are absolutely necessary
		if (options.serialProperties !== true) {
			if (options.serialProperties instanceof Array && options.serialProperties.length) {
				if (options.serialProperties[0] === true) {
					ignoring = ignoring.concat( boolDiff(serials, options.serialProperties) );
				} else {
					ignoring = ignoring.concat( boolInter(serials, options.serialProperties) );
				}
			} else {
				ignoring = ignoring.concat( serials );
			}
		}
		if (options.domProperties instanceof Array) {
			if (options.domProperties[0] === true) {
				options.domProperties = boolDiff( unique(options.domProperties, ignoring), requiring );
			} else {
				options.domProperties = boolDiff( unique(options.domProperties, requiring), ignoring );
			}
		} else {
			if (options.domProperties === false) {
				options.domProperties = requiring;
			} else {
				options.domProperties = [true].concat(ignoring);
			}
		}

		//Transform the node into an object literal
		copy = toJSON(node, options, 0);

		//Wrap our copy object in a nice object of its own to save some metadata
		if (options.metadata) {
			output.meta = extend({}, metadata, {
				clock: new Date().getTime() - timer,
				date: new Date().toISOString(),
				dimensions: {
					inner: {
						x: window.innerWidth,
						y: window.innerHeight
					},
					outer: {
						x: window.outerWidth,
						y: window.outerHeight
					}
				},
				options: options
			});
			output.node = copy;
		} else {
			output = copy;
		}

		//If opts.stringify is true, turn the output object into a JSON string
		if (options.stringify) {
			return JSON.stringify(output);
		}
		return output;
	};



	/**
	 * Create a node based on a given nodeType
	 * @param {number} type The type of DOM Node (only the integers 1, 3, 7, 8, 9, 10, 11 are valid, see https://developer.mozilla.org/en-US/docs/Web/API/Node.nodeType); currently, only nodeTypes 1,3, and 11 have been tested and are officially supported
	 * @param {DocumentFragment} doc The document fragment to which this newly created DOM Node will be added
	 * @param {Object} data The saved DOM properties that are part of the JSON representation of this DOM Node
	 * @private
	 * @ignore
	*/
	var createNode = function(type, doc, data) {
		if (doc instanceof DocumentFragment) {
			doc = doc.ownerDocument;
		}
		switch(type) {
		case 1: //HTMLElement
			if (typeof data.tagName === 'string') {
				return doc.createElement(data.tagName);
			}
			return false;

		case 3: //Text Node
			if (typeof data.nodeValue === 'string' && data.nodeValue.length) {
				return doc.createTextNode(data.nodeValue);
			}
			return doc.createTextNode('');

		case 7: //Processing Instruction
			if (data.hasOwnProperty('target') && data.hasOwnProperty('data')) {
				return doc.createProcessingInstruction(data.target, data.data);
			}
			return false;

		case 8: //Comment Node
			if (typeof data.nodeValue === 'string') {
				return doc.createComment(data.nodeValue);
			}
			return doc.createComment('');

		case 9: //HTML Document
			return doc.implementation.createHTMLDocument(data);

		case 11: //Document Fragment
			return doc;

		default: //Failed
			return false;
		}
	};



	//Recursively convert a JSON object generated by domJSON to a DOM Node
	/**
	 * Do the work of converting a JSON object/string generated by domJSON to a DOM Node
	 * @param {Object} obj The JSON representation of the DOM Node we are about to create
	 * @param {HTMLElement} parent The HTML Element to which this DOM Node will be appended
	 * @param {DocumentFragment} doc The document fragment to which this newly created DOM Node will be added
	 * @param {Object} [opts] A list of all method options
	 * @private
	 * @ignore
	*/
	var toDOM = function(obj, parent, doc, opts) {
		//Create the node, if possible
		if (obj.nodeType) {
			//Per default, some tags are not allowed
			if (obj.nodeType === 1 && !opts.allowDangerousElements) {
				for (var b in banned) {
					if (obj.tagName.toLowerCase() === banned[b]) {
						return false;
					}
				}
			}
			var node = createNode(obj.nodeType, doc, obj);
			parent.appendChild(node);
		} else {
			return false;
		}

		//Copy all available properties that are not arrays or objects
		for (var x in obj) {
			if (typeof obj[x] !== 'object' && x !== 'isContentEditable' && x !== 'childNodes') {
				try {
					node[x] = obj[x];
				} catch(e) {
					continue;
				}
			}
		}

		//If this is an HTMLElement, set the attributes
		var src;
		if (obj.nodeType === 1 && obj.tagName) {
			if (obj.attributes) {
				//Check for cross-origin
				/*src = obj.attributes.src ? 'src' : (obj.attributes.href ? 'href' : null);
				if (src) {
					obj.attributes[src] += ( (obj.attributes[src].indexOf('?') === -1) ? '?' : '&'+Math.random().toString(36).slice(-2)+'=' ) + Math.random().toString(36).slice(-4);
					obj.attributes.crossorigin = 'anonymous';
					//node.setAttribute('crossorigin', 'anonymous');
				}*/
				for (var a in obj.attributes) {
					node.setAttribute(a, obj.attributes[a]);
				}
			}
		}

		//Finally, if we have childNodes, recurse through them
		if (obj.childNodes && obj.childNodes.length) {
			for (var c in obj.childNodes) {
				toDOM(obj.childNodes[c], node, doc, opts);
			}
		}
	};



	/**
	 * Take the JSON-friendly object created by the `.toJSON()` method and rebuild it back into a DOM Node
	 * @param {Object} obj A JSON friendly object, or even JSON string, of some DOM Node
	 * @param {Object} [opts] A list of all method options
	 * @param {boolean} [opts.allowDangerousElements=`false`] Use `true` to include the potentially dangerous elements `<link>` and `<script>`
	 * @param {boolean} [opts.noMeta=`false`] `true` means that this object is not wrapped in metadata, which it makes it somewhat more difficult to rebuild properly...
	 * @return {DocumentFragment} A `DocumentFragment` (nodeType 11) containing the result of unpacking the input `obj`
	 * @method
	 * @memberof domJSON
	*/
	domJSON.toDOM = function(obj, opts) {
		var options, node;
		//Parse the JSON string if necessary
		if (typeof obj === 'string') {
			obj = JSON.parse(obj);
		}
		//Update the default options w/ the user's custom settings
		options = extend({}, defaultsForToDOM, opts);

		//Create a document fragment, and away we go!
		node = document.createDocumentFragment();
		if (options.noMeta) {
			toDOM(obj, node, node, options);
		} else {
			toDOM(obj.node, node, node, options);
		}
		return node;
	};



	/* test-code */
	//The code below is only included for private API testing, and needs to be removed in distributed builds
	domJSON.__extend = extend;
	domJSON.__unique = unique;
	domJSON.__copy = copy;
	domJSON.__boolFilter = boolFilter;
	domJSON.__boolInter = boolInter;
	domJSON.__boolDiff = boolDiff;
	domJSON.__toShorthand = toShorthand;
	/* end-test-code */

	return domJSON;
});


(function() {
    var initialX = 0;
    var initialY = 0;

    function onMouseMove(ev) {
        var x = ev.screenX - initialX;
        var y = ev.screenY - initialY;
        window.pywebview._bridge.call('pywebviewMoveWindow', [x, y], 'move');
    }

    function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    }

    function onMouseDown(ev) {
        initialX = ev.clientX;
        initialY = ev.clientY;
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('mousemove', onMouseMove);
    }

    var dragBlocks = document.querySelectorAll('.pywebview-drag-region');
    for (var i=0; i < dragBlocks.length; i++) {
        dragBlocks[i].addEventListener('mousedown', onMouseDown);
    }
        // easy drag for edge chromium
    if (false) {
        window.addEventListener('mousedown', onMouseDown);
    }

})();

// zoomable
if (!false) {
    document.body.addEventListener('touchstart', function(e) {
        if ((e.touches.length > 1) || e.targetTouches.length > 1) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }
    }, {passive: false});

    window.addEventListener('wheel', function (e) {
        if (e.ctrlKey) {
            e.preventDefault();
        }
    }, {passive: false});
}

// draggable
if (!false) {
    document.querySelectorAll("img").forEach(function(img) {
        img.setAttribute("draggable", false);
    })

    document.querySelectorAll("a").forEach(function(a) {
        a.setAttribute("draggable", false);
    })
}


/*==========*/
document.readyState == "complete"
/*==========*/
createCustomParameterSection(` 
                <form method="post" action="/parameter">
                    
            <div class="input">
                <label for="hello">hello</label>
                <input name="hello" type="text" value="hi">
            </div>
            
                    <div class="submit">
                        <button type="submit">Apply</button>
                    </div>
                </form>
            `)
/*==========*/

window.callbackFunction = pywebview.api.callback
window.dloqqrvj = new Lib.Handler("window.dloqqrvj", 1.0, 1.0, "left", true)
window.dloqqrvj.series.setData([
  {
    "Unnamed: 0": 0,
    "time": 1277769600,
    "open": 1.2667,
    "high": 1.6667,
    "low": 1.1693,
    "close": 1.5927,
    "volume": 277519500.0
  },
  {
    "Unnamed: 0": 1,
    "time": 1277856000,
    "open": 1.6713,
    "high": 2.028,
    "low": 1.5533,
    "close": 1.5887,
    "volume": 253039500.0
  },
  {
    "Unnamed: 0": 2,
    "time": 1277942400,
    "open": 1.6627,
    "high": 1.728,
    "low": 1.3513,
    "close": 1.464,
    "volume": 121461000.0
  },
  {
    "Unnamed: 0": 3,
    "time": 1278028800,
    "open": 1.47,
    "high": 1.55,
    "low": 1.2473,
    "close": 1.28,
    "volume": 75871500.0
  },
  {
    "Unnamed: 0": 4,
    "time": 1278374400,
    "open": 1.2867,
    "high": 1.3333,
    "low": 1.0553,
    "close": 1.074,
    "volume": 101664000.0
  },
  {
    "Unnamed: 0": 5,
    "time": 1278460800,
    "open": 1.0933,
    "high": 1.1087,
    "low": 0.9987,
    "close": 1.0533,
    "volume": 102645000.0
  },
  {
    "Unnamed: 0": 6,
    "time": 1278547200,
    "open": 1.0567,
    "high": 1.1793,
    "low": 1.038,
    "close": 1.164,
    "volume": 114526500.0
  },
  {
    "Unnamed: 0": 7,
    "time": 1278633600,
    "open": 1.18,
    "high": 1.1933,
    "low": 1.1033,
    "close": 1.16,
    "volume": 60061500.0
  },
  {
    "Unnamed: 0": 8,
    "time": 1278892800,
    "open": 1.1533,
    "high": 1.2047,
    "low": 1.1233,
    "close": 1.1413,
    "volume": 32487000.0
  },
  {
    "Unnamed: 0": 9,
    "time": 1278979200,
    "open": 1.1533,
    "high": 1.2427,
    "low": 1.1267,
    "close": 1.2093,
    "volume": 39439500.0
  },
  {
    "Unnamed: 0": 10,
    "time": 1279065600,
    "open": 1.2067,
    "high": 1.3433,
    "low": 1.184,
    "close": 1.3227,
    "volume": 62097000.0
  },
  {
    "Unnamed: 0": 11,
    "time": 1279152000,
    "open": 1.32,
    "high": 1.4333,
    "low": 1.2667,
    "close": 1.326,
    "volume": 55222500.0
  },
  {
    "Unnamed: 0": 12,
    "time": 1279238400,
    "open": 1.3267,
    "high": 1.42,
    "low": 1.326,
    "close": 1.376,
    "volume": 37939500.0
  },
  {
    "Unnamed: 0": 13,
    "time": 1279497600,
    "open": 1.4,
    "high": 1.4893,
    "low": 1.3867,
    "close": 1.4367,
    "volume": 36303000.0
  },
  {
    "Unnamed: 0": 14,
    "time": 1279584000,
    "open": 1.466,
    "high": 1.4853,
    "low": 1.328,
    "close": 1.3533,
    "volume": 26229000.0
  },
  {
    "Unnamed: 0": 15,
    "time": 1279670400,
    "open": 1.36,
    "high": 1.41,
    "low": 1.3,
    "close": 1.348,
    "volume": 18214500.0
  },
  {
    "Unnamed: 0": 16,
    "time": 1279756800,
    "open": 1.3507,
    "high": 1.4167,
    "low": 1.35,
    "close": 1.4,
    "volume": 13924500.0
  },
  {
    "Unnamed: 0": 17,
    "time": 1279843200,
    "open": 1.416,
    "high": 1.4373,
    "low": 1.4013,
    "close": 1.4193,
    "volume": 9603000.0
  },
  {
    "Unnamed: 0": 18,
    "time": 1280102400,
    "open": 1.4187,
    "high": 1.4513,
    "low": 1.3533,
    "close": 1.3953,
    "volume": 13416000.0
  },
  {
    "Unnamed: 0": 19,
    "time": 1280188800,
    "open": 1.3973,
    "high": 1.412,
    "low": 1.3507,
    "close": 1.37,
    "volume": 8658000.0
  },
  {
    "Unnamed: 0": 20,
    "time": 1280275200,
    "open": 1.3673,
    "high": 1.3933,
    "low": 1.3673,
    "close": 1.3813,
    "volume": 6801000.0
  },
  {
    "Unnamed: 0": 21,
    "time": 1280361600,
    "open": 1.3847,
    "high": 1.392,
    "low": 1.3333,
    "close": 1.3567,
    "volume": 8734500.0
  },
  {
    "Unnamed: 0": 22,
    "time": 1280448000,
    "open": 1.3567,
    "high": 1.3627,
    "low": 1.3033,
    "close": 1.3293,
    "volume": 6258000.0
  },
  {
    "Unnamed: 0": 23,
    "time": 1280707200,
    "open": 1.338,
    "high": 1.4,
    "low": 1.338,
    "close": 1.3807,
    "volume": 10417500.0
  },
  {
    "Unnamed: 0": 24,
    "time": 1280793600,
    "open": 1.384,
    "high": 1.4633,
    "low": 1.3593,
    "close": 1.4633,
    "volume": 17827500.0
  },
  {
    "Unnamed: 0": 25,
    "time": 1280880000,
    "open": 1.4867,
    "high": 1.4867,
    "low": 1.3407,
    "close": 1.4173,
    "volume": 13594500.0
  },
  {
    "Unnamed: 0": 26,
    "time": 1280966400,
    "open": 1.3967,
    "high": 1.442,
    "low": 1.3367,
    "close": 1.3633,
    "volume": 11722500.0
  },
  {
    "Unnamed: 0": 27,
    "time": 1281052800,
    "open": 1.336,
    "high": 1.35,
    "low": 1.3013,
    "close": 1.306,
    "volume": 10542000.0
  },
  {
    "Unnamed: 0": 28,
    "time": 1281312000,
    "open": 1.302,
    "high": 1.3333,
    "low": 1.2967,
    "close": 1.3053,
    "volume": 10684500.0
  },
  {
    "Unnamed: 0": 29,
    "time": 1281398400,
    "open": 1.3067,
    "high": 1.31,
    "low": 1.2547,
    "close": 1.2687,
    "volume": 17506500.0
  },
  {
    "Unnamed: 0": 30,
    "time": 1281484800,
    "open": 1.2447,
    "high": 1.26,
    "low": 1.1833,
    "close": 1.1933,
    "volume": 11340000.0
  },
  {
    "Unnamed: 0": 31,
    "time": 1281571200,
    "open": 1.1933,
    "high": 1.2133,
    "low": 1.1593,
    "close": 1.1733,
    "volume": 10168500.0
  },
  {
    "Unnamed: 0": 32,
    "time": 1281657600,
    "open": 1.1847,
    "high": 1.24,
    "low": 1.1773,
    "close": 1.2213,
    "volume": 9385500.0
  },
  {
    "Unnamed: 0": 33,
    "time": 1281916800,
    "open": 1.2333,
    "high": 1.2533,
    "low": 1.2173,
    "close": 1.25,
    "volume": 7186500.0
  },
  {
    "Unnamed: 0": 34,
    "time": 1282003200,
    "open": 1.25,
    "high": 1.2933,
    "low": 1.25,
    "close": 1.2767,
    "volume": 6597000.0
  },
  {
    "Unnamed: 0": 35,
    "time": 1282089600,
    "open": 1.28,
    "high": 1.306,
    "low": 1.2333,
    "close": 1.2513,
    "volume": 8905500.0
  },
  {
    "Unnamed: 0": 36,
    "time": 1282176000,
    "open": 1.236,
    "high": 1.2833,
    "low": 1.222,
    "close": 1.2527,
    "volume": 8290500.0
  },
  {
    "Unnamed: 0": 37,
    "time": 1282262400,
    "open": 1.2333,
    "high": 1.2787,
    "low": 1.2333,
    "close": 1.2733,
    "volume": 4381500.0
  },
  {
    "Unnamed: 0": 38,
    "time": 1282521600,
    "open": 1.2727,
    "high": 1.3593,
    "low": 1.2667,
    "close": 1.3467,
    "volume": 16048500.0
  },
  {
    "Unnamed: 0": 39,
    "time": 1282608000,
    "open": 1.3267,
    "high": 1.3267,
    "low": 1.2633,
    "close": 1.28,
    "volume": 9973500.0
  },
  {
    "Unnamed: 0": 40,
    "time": 1282694400,
    "open": 1.2667,
    "high": 1.332,
    "low": 1.2373,
    "close": 1.3267,
    "volume": 7372500.0
  },
  {
    "Unnamed: 0": 41,
    "time": 1282780800,
    "open": 1.316,
    "high": 1.3513,
    "low": 1.3067,
    "close": 1.3167,
    "volume": 6189000.0
  },
  {
    "Unnamed: 0": 42,
    "time": 1282867200,
    "open": 1.3333,
    "high": 1.334,
    "low": 1.3,
    "close": 1.3133,
    "volume": 5628000.0
  },
  {
    "Unnamed: 0": 43,
    "time": 1283126400,
    "open": 1.3133,
    "high": 1.346,
    "low": 1.3073,
    "close": 1.32,
    "volume": 10831500.0
  },
  {
    "Unnamed: 0": 44,
    "time": 1283212800,
    "open": 1.292,
    "high": 1.3193,
    "low": 1.2887,
    "close": 1.2987,
    "volume": 2956500.0
  },
  {
    "Unnamed: 0": 45,
    "time": 1283299200,
    "open": 1.308,
    "high": 1.3793,
    "low": 1.3067,
    "close": 1.3633,
    "volume": 7306500.0
  },
  {
    "Unnamed: 0": 46,
    "time": 1283385600,
    "open": 1.3633,
    "high": 1.416,
    "low": 1.354,
    "close": 1.404,
    "volume": 7159500.0
  },
  {
    "Unnamed: 0": 47,
    "time": 1283472000,
    "open": 1.4067,
    "high": 1.4327,
    "low": 1.3773,
    "close": 1.4033,
    "volume": 6402000.0
  },
  {
    "Unnamed: 0": 48,
    "time": 1283817600,
    "open": 1.388,
    "high": 1.4,
    "low": 1.3667,
    "close": 1.3693,
    "volume": 3612000.0
  },
  {
    "Unnamed: 0": 49,
    "time": 1283904000,
    "open": 1.372,
    "high": 1.3967,
    "low": 1.372,
    "close": 1.3933,
    "volume": 4281000.0
  },
  {
    "Unnamed: 0": 50,
    "time": 1283990400,
    "open": 1.3953,
    "high": 1.4033,
    "low": 1.3347,
    "close": 1.3807,
    "volume": 5586000.0
  },
  {
    "Unnamed: 0": 51,
    "time": 1284076800,
    "open": 1.3833,
    "high": 1.3953,
    "low": 1.3173,
    "close": 1.3447,
    "volume": 5706000.0
  },
  {
    "Unnamed: 0": 52,
    "time": 1284336000,
    "open": 1.3733,
    "high": 1.3933,
    "low": 1.3667,
    "close": 1.386,
    "volume": 5361000.0
  },
  {
    "Unnamed: 0": 53,
    "time": 1284422400,
    "open": 1.3693,
    "high": 1.44,
    "low": 1.3687,
    "close": 1.408,
    "volume": 9564000.0
  },
  {
    "Unnamed: 0": 54,
    "time": 1284508800,
    "open": 1.3987,
    "high": 1.4667,
    "low": 1.386,
    "close": 1.4653,
    "volume": 9990000.0
  },
  {
    "Unnamed: 0": 55,
    "time": 1284595200,
    "open": 1.4867,
    "high": 1.544,
    "low": 1.3873,
    "close": 1.396,
    "volume": 38347500.0
  },
  {
    "Unnamed: 0": 56,
    "time": 1284681600,
    "open": 1.4213,
    "high": 1.4233,
    "low": 1.32,
    "close": 1.3487,
    "volume": 17478000.0
  },
  {
    "Unnamed: 0": 57,
    "time": 1284940800,
    "open": 1.35,
    "high": 1.4233,
    "low": 1.344,
    "close": 1.4,
    "volume": 13968000.0
  },
  {
    "Unnamed: 0": 58,
    "time": 1285027200,
    "open": 1.4193,
    "high": 1.4367,
    "low": 1.378,
    "close": 1.3847,
    "volume": 11749500.0
  },
  {
    "Unnamed: 0": 59,
    "time": 1285113600,
    "open": 1.3913,
    "high": 1.3967,
    "low": 1.32,
    "close": 1.3247,
    "volume": 13227000.0
  },
  {
    "Unnamed: 0": 60,
    "time": 1285200000,
    "open": 1.32,
    "high": 1.3427,
    "low": 1.3,
    "close": 1.304,
    "volume": 9856500.0
  },
  {
    "Unnamed: 0": 61,
    "time": 1285286400,
    "open": 1.33,
    "high": 1.346,
    "low": 1.31,
    "close": 1.34,
    "volume": 8590500.0
  },
  {
    "Unnamed: 0": 62,
    "time": 1285545600,
    "open": 1.3467,
    "high": 1.3873,
    "low": 1.3333,
    "close": 1.386,
    "volume": 6181500.0
  },
  {
    "Unnamed: 0": 63,
    "time": 1285632000,
    "open": 1.398,
    "high": 1.4327,
    "low": 1.384,
    "close": 1.4267,
    "volume": 17905500.0
  },
  {
    "Unnamed: 0": 64,
    "time": 1285718400,
    "open": 1.3667,
    "high": 1.4733,
    "low": 1.3667,
    "close": 1.4653,
    "volume": 27925500.0
  },
  {
    "Unnamed: 0": 65,
    "time": 1285804800,
    "open": 1.466,
    "high": 1.4767,
    "low": 1.346,
    "close": 1.3603,
    "volume": 31186500.0
  },
  {
    "Unnamed: 0": 66,
    "time": 1285891200,
    "open": 1.3867,
    "high": 1.4167,
    "low": 1.346,
    "close": 1.3733,
    "volume": 7783500.0
  },
  {
    "Unnamed: 0": 67,
    "time": 1286150400,
    "open": 1.34,
    "high": 1.4113,
    "low": 1.34,
    "close": 1.4,
    "volume": 9444000.0
  },
  {
    "Unnamed: 0": 68,
    "time": 1286236800,
    "open": 1.41,
    "high": 1.4187,
    "low": 1.4007,
    "close": 1.408,
    "volume": 4914000.0
  },
  {
    "Unnamed: 0": 69,
    "time": 1286323200,
    "open": 1.404,
    "high": 1.4173,
    "low": 1.3547,
    "close": 1.364,
    "volume": 4617000.0
  },
  {
    "Unnamed: 0": 70,
    "time": 1286409600,
    "open": 1.3713,
    "high": 1.376,
    "low": 1.354,
    "close": 1.362,
    "volume": 2064000.0
  },
  {
    "Unnamed: 0": 71,
    "time": 1286496000,
    "open": 1.362,
    "high": 1.386,
    "low": 1.3573,
    "close": 1.362,
    "volume": 3973500.0
  },
  {
    "Unnamed: 0": 72,
    "time": 1286755200,
    "open": 1.3667,
    "high": 1.38,
    "low": 1.338,
    "close": 1.34,
    "volume": 2497500.0
  },
  {
    "Unnamed: 0": 73,
    "time": 1286841600,
    "open": 1.3467,
    "high": 1.352,
    "low": 1.3353,
    "close": 1.3493,
    "volume": 3405000.0
  },
  {
    "Unnamed: 0": 74,
    "time": 1286928000,
    "open": 1.3507,
    "high": 1.4233,
    "low": 1.3507,
    "close": 1.3693,
    "volume": 4728000.0
  },
  {
    "Unnamed: 0": 75,
    "time": 1287014400,
    "open": 1.4333,
    "high": 1.4333,
    "low": 1.36,
    "close": 1.3833,
    "volume": 4314000.0
  },
  {
    "Unnamed: 0": 76,
    "time": 1287100800,
    "open": 1.3927,
    "high": 1.3933,
    "low": 1.35,
    "close": 1.3693,
    "volume": 4189500.0
  },
  {
    "Unnamed: 0": 77,
    "time": 1287360000,
    "open": 1.376,
    "high": 1.376,
    "low": 1.348,
    "close": 1.3487,
    "volume": 2374500.0
  },
  {
    "Unnamed: 0": 78,
    "time": 1287446400,
    "open": 1.3467,
    "high": 1.3607,
    "low": 1.3333,
    "close": 1.3367,
    "volume": 3601500.0
  },
  {
    "Unnamed: 0": 79,
    "time": 1287532800,
    "open": 1.344,
    "high": 1.3793,
    "low": 1.336,
    "close": 1.3767,
    "volume": 4608000.0
  },
  {
    "Unnamed: 0": 80,
    "time": 1287619200,
    "open": 1.374,
    "high": 1.3967,
    "low": 1.3633,
    "close": 1.3833,
    "volume": 6166500.0
  },
  {
    "Unnamed: 0": 81,
    "time": 1287705600,
    "open": 1.3787,
    "high": 1.3953,
    "low": 1.37,
    "close": 1.3813,
    "volume": 2374500.0
  },
  {
    "Unnamed: 0": 82,
    "time": 1287964800,
    "open": 1.3947,
    "high": 1.3987,
    "low": 1.382,
    "close": 1.3987,
    "volume": 1737000.0
  },
  {
    "Unnamed: 0": 83,
    "time": 1288051200,
    "open": 1.3867,
    "high": 1.458,
    "low": 1.3673,
    "close": 1.424,
    "volume": 9744000.0
  },
  {
    "Unnamed: 0": 84,
    "time": 1288137600,
    "open": 1.4,
    "high": 1.4,
    "low": 1.4,
    "close": 1.4,
    "volume": 0.0
  },
  {
    "Unnamed: 0": 85,
    "time": 1294272000,
    "open": 1.7907,
    "high": 1.8667,
    "low": 1.7873,
    "close": 1.8467,
    "volume": 28846500.0
  },
  {
    "Unnamed: 0": 86,
    "time": 1294358400,
    "open": 1.8533,
    "high": 1.9053,
    "low": 1.8533,
    "close": 1.876,
    "volume": 33460500.0
  },
  {
    "Unnamed: 0": 87,
    "time": 1294617600,
    "open": 1.8773,
    "high": 1.912,
    "low": 1.87,
    "close": 1.91,
    "volume": 19849500.0
  },
  {
    "Unnamed: 0": 88,
    "time": 1294704000,
    "open": 1.9073,
    "high": 1.914,
    "low": 1.782,
    "close": 1.7973,
    "volume": 25282500.0
  },
  {
    "Unnamed: 0": 89,
    "time": 1294790400,
    "open": 1.8007,
    "high": 1.8267,
    "low": 1.768,
    "close": 1.7973,
    "volume": 13564500.0
  },
  {
    "Unnamed: 0": 90,
    "time": 1294876800,
    "open": 1.7967,
    "high": 1.7993,
    "low": 1.744,
    "close": 1.7533,
    "volume": 10503000.0
  },
  {
    "Unnamed: 0": 91,
    "time": 1294963200,
    "open": 1.7553,
    "high": 1.772,
    "low": 1.7073,
    "close": 1.7193,
    "volume": 17412000.0
  },
  {
    "Unnamed: 0": 92,
    "time": 1295308800,
    "open": 1.74,
    "high": 1.74,
    "low": 1.65,
    "close": 1.7093,
    "volume": 23950500.0
  },
  {
    "Unnamed: 0": 93,
    "time": 1295395200,
    "open": 1.6847,
    "high": 1.698,
    "low": 1.5833,
    "close": 1.602,
    "volume": 35040000.0
  },
  {
    "Unnamed: 0": 94,
    "time": 1295481600,
    "open": 1.6133,
    "high": 1.63,
    "low": 1.4913,
    "close": 1.5167,
    "volume": 33759000.0
  },
  {
    "Unnamed: 0": 95,
    "time": 1295568000,
    "open": 1.5247,
    "high": 1.5727,
    "low": 1.514,
    "close": 1.5333,
    "volume": 18036000.0
  },
  {
    "Unnamed: 0": 96,
    "time": 1295827200,
    "open": 1.5567,
    "high": 1.654,
    "low": 1.5487,
    "close": 1.6333,
    "volume": 24352500.0
  },
  {
    "Unnamed: 0": 97,
    "time": 1295913600,
    "open": 1.6433,
    "high": 1.6593,
    "low": 1.6013,
    "close": 1.6453,
    "volume": 18924000.0
  },
  {
    "Unnamed: 0": 98,
    "time": 1296000000,
    "open": 1.66,
    "high": 1.66,
    "low": 1.6067,
    "close": 1.65,
    "volume": 16050000.0
  },
  {
    "Unnamed: 0": 99,
    "time": 1296086400,
    "open": 1.6567,
    "high": 1.672,
    "low": 1.6353,
    "close": 1.6647,
    "volume": 12790500.0
  },
  {
    "Unnamed: 0": 100,
    "time": 1296172800,
    "open": 1.6533,
    "high": 1.6613,
    "low": 1.5833,
    "close": 1.6,
    "volume": 15490500.0
  },
  {
    "Unnamed: 0": 101,
    "time": 1296432000,
    "open": 1.6393,
    "high": 1.6393,
    "low": 1.5667,
    "close": 1.6007,
    "volume": 11974500.0
  },
  {
    "Unnamed: 0": 102,
    "time": 1296518400,
    "open": 1.6367,
    "high": 1.6487,
    "low": 1.5693,
    "close": 1.594,
    "volume": 10473000.0
  },
  {
    "Unnamed: 0": 103,
    "time": 1296604800,
    "open": 1.594,
    "high": 1.612,
    "low": 1.578,
    "close": 1.596,
    "volume": 8454000.0
  },
  {
    "Unnamed: 0": 104,
    "time": 1296691200,
    "open": 1.588,
    "high": 1.5933,
    "low": 1.5433,
    "close": 1.5807,
    "volume": 7540500.0
  },
  {
    "Unnamed: 0": 105,
    "time": 1296777600,
    "open": 1.5647,
    "high": 1.578,
    "low": 1.548,
    "close": 1.5753,
    "volume": 8067000.0
  },
  {
    "Unnamed: 0": 106,
    "time": 1297036800,
    "open": 1.556,
    "high": 1.5567,
    "low": 1.5253,
    "close": 1.538,
    "volume": 13209000.0
  },
  {
    "Unnamed: 0": 107,
    "time": 1297123200,
    "open": 1.534,
    "high": 1.6833,
    "low": 1.5333,
    "close": 1.6327,
    "volume": 51768000.0
  },
  {
    "Unnamed: 0": 108,
    "time": 1297209600,
    "open": 1.6173,
    "high": 1.6327,
    "low": 1.5193,
    "close": 1.5473,
    "volume": 37779000.0
  },
  {
    "Unnamed: 0": 109,
    "time": 1297296000,
    "open": 1.5333,
    "high": 1.576,
    "low": 1.5207,
    "close": 1.5513,
    "volume": 12324000.0
  },
  {
    "Unnamed: 0": 110,
    "time": 1297382400,
    "open": 1.55,
    "high": 1.5833,
    "low": 1.5293,
    "close": 1.5333,
    "volume": 9424500.0
  },
  {
    "Unnamed: 0": 111,
    "time": 1297641600,
    "open": 1.5487,
    "high": 1.6093,
    "low": 1.5367,
    "close": 1.546,
    "volume": 18984000.0
  },
  {
    "Unnamed: 0": 112,
    "time": 1297728000,
    "open": 1.546,
    "high": 1.5667,
    "low": 1.4973,
    "close": 1.5227,
    "volume": 14146500.0
  },
  {
    "Unnamed: 0": 113,
    "time": 1297814400,
    "open": 1.5333,
    "high": 1.6647,
    "low": 1.5273,
    "close": 1.6487,
    "volume": 60928500.0
  },
  {
    "Unnamed: 0": 114,
    "time": 1297900800,
    "open": 1.6667,
    "high": 1.6993,
    "low": 1.558,
    "close": 1.5833,
    "volume": 38383500.0
  },
  {
    "Unnamed: 0": 115,
    "time": 1297987200,
    "open": 1.5733,
    "high": 1.5733,
    "low": 1.5307,
    "close": 1.5353,
    "volume": 35118000.0
  },
  {
    "Unnamed: 0": 116,
    "time": 1298332800,
    "open": 1.5807,
    "high": 1.5807,
    "low": 1.452,
    "close": 1.458,
    "volume": 30369000.0
  },
  {
    "Unnamed: 0": 117,
    "time": 1298419200,
    "open": 1.496,
    "high": 1.5,
    "low": 1.4073,
    "close": 1.4553,
    "volume": 23451000.0
  },
  {
    "Unnamed: 0": 118,
    "time": 1298505600,
    "open": 1.4667,
    "high": 1.5053,
    "low": 1.4333,
    "close": 1.4813,
    "volume": 15372000.0
  },
  {
    "Unnamed: 0": 119,
    "time": 1298592000,
    "open": 1.5067,
    "high": 1.59,
    "low": 1.5053,
    "close": 1.5687,
    "volume": 19941000.0
  },
  {
    "Unnamed: 0": 120,
    "time": 1298851200,
    "open": 1.5827,
    "high": 1.6067,
    "low": 1.5667,
    "close": 1.574,
    "volume": 15580500.0
  },
  {
    "Unnamed: 0": 121,
    "time": 1298937600,
    "open": 1.5927,
    "high": 1.6213,
    "low": 1.58,
    "close": 1.596,
    "volume": 16422000.0
  },
  {
    "Unnamed: 0": 122,
    "time": 1299024000,
    "open": 1.596,
    "high": 1.6187,
    "low": 1.582,
    "close": 1.6013,
    "volume": 9826500.0
  },
  {
    "Unnamed: 0": 123,
    "time": 1299110400,
    "open": 1.632,
    "high": 1.6527,
    "low": 1.604,
    "close": 1.6207,
    "volume": 9478500.0
  },
  {
    "Unnamed: 0": 124,
    "time": 1299196800,
    "open": 1.628,
    "high": 1.666,
    "low": 1.5853,
    "close": 1.646,
    "volume": 22677000.0
  },
  {
    "Unnamed: 0": 125,
    "time": 1299456000,
    "open": 1.67,
    "high": 1.6933,
    "low": 1.6467,
    "close": 1.6587,
    "volume": 30210000.0
  },
  {
    "Unnamed: 0": 126,
    "time": 1299542400,
    "open": 1.6587,
    "high": 1.664,
    "low": 1.6,
    "close": 1.644,
    "volume": 20715000.0
  },
  {
    "Unnamed: 0": 127,
    "time": 1299628800,
    "open": 1.644,
    "high": 1.666,
    "low": 1.618,
    "close": 1.648,
    "volume": 13692000.0
  },
  {
    "Unnamed: 0": 128,
    "time": 1299715200,
    "open": 1.6293,
    "high": 1.648,
    "low": 1.582,
    "close": 1.6133,
    "volume": 14049000.0
  },
  {
    "Unnamed: 0": 129,
    "time": 1299801600,
    "open": 1.6047,
    "high": 1.6167,
    "low": 1.5687,
    "close": 1.6033,
    "volume": 13821000.0
  },
  {
    "Unnamed: 0": 130,
    "time": 1300060800,
    "open": 1.5733,
    "high": 1.608,
    "low": 1.5467,
    "close": 1.5507,
    "volume": 17205000.0
  },
  {
    "Unnamed: 0": 131,
    "time": 1300147200,
    "open": 1.4927,
    "high": 1.5307,
    "low": 1.4533,
    "close": 1.53,
    "volume": 19534500.0
  },
  {
    "Unnamed: 0": 132,
    "time": 1300233600,
    "open": 1.524,
    "high": 1.55,
    "low": 1.5127,
    "close": 1.5213,
    "volume": 17208000.0
  },
  {
    "Unnamed: 0": 133,
    "time": 1300320000,
    "open": 1.5433,
    "high": 1.562,
    "low": 1.5093,
    "close": 1.5207,
    "volume": 12612000.0
  },
  {
    "Unnamed: 0": 134,
    "time": 1300406400,
    "open": 1.546,
    "high": 1.546,
    "low": 1.5007,
    "close": 1.522,
    "volume": 10195500.0
  },
  {
    "Unnamed: 0": 135,
    "time": 1300665600,
    "open": 1.5333,
    "high": 1.5467,
    "low": 1.5027,
    "close": 1.516,
    "volume": 6057000.0
  },
  {
    "Unnamed: 0": 136,
    "time": 1300752000,
    "open": 1.5153,
    "high": 1.524,
    "low": 1.4667,
    "close": 1.4793,
    "volume": 8097000.0
  },
  {
    "Unnamed: 0": 137,
    "time": 1300838400,
    "open": 1.4707,
    "high": 1.4847,
    "low": 1.4513,
    "close": 1.4807,
    "volume": 5943000.0
  },
  {
    "Unnamed: 0": 138,
    "time": 1300924800,
    "open": 1.48,
    "high": 1.5,
    "low": 1.4653,
    "close": 1.5,
    "volume": 6564000.0
  },
  {
    "Unnamed: 0": 139,
    "time": 1301011200,
    "open": 1.4953,
    "high": 1.5333,
    "low": 1.4933,
    "close": 1.5167,
    "volume": 8416500.0
  },
  {
    "Unnamed: 0": 140,
    "time": 1301270400,
    "open": 1.5307,
    "high": 1.5693,
    "low": 1.5033,
    "close": 1.528,
    "volume": 15309000.0
  },
  {
    "Unnamed: 0": 141,
    "time": 1301356800,
    "open": 1.5533,
    "high": 1.6,
    "low": 1.5473,
    "close": 1.5947,
    "volume": 11188500.0
  },
  {
    "Unnamed: 0": 142,
    "time": 1301443200,
    "open": 1.5933,
    "high": 1.6327,
    "low": 1.534,
    "close": 1.5807,
    "volume": 18003000.0
  },
  {
    "Unnamed: 0": 143,
    "time": 1301529600,
    "open": 1.6093,
    "high": 1.914,
    "low": 1.6093,
    "close": 1.842,
    "volume": 163869000.0
  },
  {
    "Unnamed: 0": 144,
    "time": 1301616000,
    "open": 1.8667,
    "high": 1.8787,
    "low": 1.7713,
    "close": 1.7793,
    "volume": 42078000.0
  },
  {
    "Unnamed: 0": 145,
    "time": 1301875200,
    "open": 1.7687,
    "high": 1.8,
    "low": 1.682,
    "close": 1.7207,
    "volume": 38563500.0
  },
  {
    "Unnamed: 0": 146,
    "time": 1301961600,
    "open": 1.7567,
    "high": 1.8,
    "low": 1.7127,
    "close": 1.78,
    "volume": 46600500.0
  },
  {
    "Unnamed: 0": 147,
    "time": 1302048000,
    "open": 1.778,
    "high": 1.8007,
    "low": 1.72,
    "close": 1.7633,
    "volume": 18907500.0
  },
  {
    "Unnamed: 0": 148,
    "time": 1302134400,
    "open": 1.772,
    "high": 1.8627,
    "low": 1.7633,
    "close": 1.8273,
    "volume": 41496000.0
  },
  {
    "Unnamed: 0": 149,
    "time": 1302220800,
    "open": 1.846,
    "high": 1.846,
    "low": 1.7573,
    "close": 1.7667,
    "volume": 28378500.0
  },
  {
    "Unnamed: 0": 150,
    "time": 1302480000,
    "open": 1.7833,
    "high": 1.7833,
    "low": 1.6667,
    "close": 1.6667,
    "volume": 20121000.0
  },
  {
    "Unnamed: 0": 151,
    "time": 1302566400,
    "open": 1.6707,
    "high": 1.6827,
    "low": 1.62,
    "close": 1.65,
    "volume": 20044500.0
  },
  {
    "Unnamed: 0": 152,
    "time": 1302652800,
    "open": 1.662,
    "high": 1.7127,
    "low": 1.6533,
    "close": 1.6533,
    "volume": 17970000.0
  },
  {
    "Unnamed: 0": 153,
    "time": 1302739200,
    "open": 1.6527,
    "high": 1.6853,
    "low": 1.6133,
    "close": 1.6767,
    "volume": 14481000.0
  },
  {
    "Unnamed: 0": 154,
    "time": 1302825600,
    "open": 1.7,
    "high": 1.7453,
    "low": 1.69,
    "close": 1.6913,
    "volume": 13975500.0
  },
  {
    "Unnamed: 0": 155,
    "time": 1303084800,
    "open": 1.678,
    "high": 1.708,
    "low": 1.624,
    "close": 1.6653,
    "volume": 15267000.0
  },
  {
    "Unnamed: 0": 156,
    "time": 1303171200,
    "open": 1.668,
    "high": 1.684,
    "low": 1.6433,
    "close": 1.6833,
    "volume": 8127000.0
  },
  {
    "Unnamed: 0": 157,
    "time": 1303257600,
    "open": 1.7013,
    "high": 1.7393,
    "low": 1.6867,
    "close": 1.72,
    "volume": 12396000.0
  },
  {
    "Unnamed: 0": 158,
    "time": 1303344000,
    "open": 1.72,
    "high": 1.7987,
    "low": 1.706,
    "close": 1.7647,
    "volume": 19473000.0
  },
  {
    "Unnamed: 0": 159,
    "time": 1303689600,
    "open": 1.78,
    "high": 1.79,
    "low": 1.7313,
    "close": 1.762,
    "volume": 11760000.0
  },
  {
    "Unnamed: 0": 160,
    "time": 1303776000,
    "open": 1.7647,
    "high": 1.8167,
    "low": 1.754,
    "close": 1.7953,
    "volume": 20268000.0
  },
  {
    "Unnamed: 0": 161,
    "time": 1303862400,
    "open": 1.8007,
    "high": 1.824,
    "low": 1.7753,
    "close": 1.8013,
    "volume": 14770500.0
  },
  {
    "Unnamed: 0": 162,
    "time": 1303948800,
    "open": 1.8167,
    "high": 1.846,
    "low": 1.7813,
    "close": 1.83,
    "volume": 23356500.0
  },
  {
    "Unnamed: 0": 163,
    "time": 1304035200,
    "open": 1.846,
    "high": 1.858,
    "low": 1.82,
    "close": 1.82,
    "volume": 9780000.0
  },
  {
    "Unnamed: 0": 164,
    "time": 1304294400,
    "open": 1.8467,
    "high": 1.8533,
    "low": 1.804,
    "close": 1.816,
    "volume": 11614500.0
  },
  {
    "Unnamed: 0": 165,
    "time": 1304380800,
    "open": 1.8267,
    "high": 1.83,
    "low": 1.7667,
    "close": 1.82,
    "volume": 13510500.0
  },
  {
    "Unnamed: 0": 166,
    "time": 1304467200,
    "open": 1.7853,
    "high": 1.9333,
    "low": 1.7167,
    "close": 1.8467,
    "volume": 15252000.0
  },
  {
    "Unnamed: 0": 167,
    "time": 1304553600,
    "open": 1.8167,
    "high": 1.864,
    "low": 1.7447,
    "close": 1.7987,
    "volume": 17584500.0
  },
  {
    "Unnamed: 0": 168,
    "time": 1304640000,
    "open": 1.7833,
    "high": 1.8467,
    "low": 1.7747,
    "close": 1.808,
    "volume": 13941000.0
  },
  {
    "Unnamed: 0": 169,
    "time": 1304899200,
    "open": 1.8527,
    "high": 1.8667,
    "low": 1.79,
    "close": 1.828,
    "volume": 13521000.0
  },
  {
    "Unnamed: 0": 170,
    "time": 1304985600,
    "open": 1.8733,
    "high": 1.93,
    "low": 1.8607,
    "close": 1.8873,
    "volume": 22632000.0
  },
  {
    "Unnamed: 0": 171,
    "time": 1305072000,
    "open": 1.892,
    "high": 1.892,
    "low": 1.78,
    "close": 1.79,
    "volume": 14250000.0
  },
  {
    "Unnamed: 0": 172,
    "time": 1305158400,
    "open": 1.7833,
    "high": 1.85,
    "low": 1.7567,
    "close": 1.85,
    "volume": 9286500.0
  },
  {
    "Unnamed: 0": 173,
    "time": 1305244800,
    "open": 1.86,
    "high": 1.8793,
    "low": 1.82,
    "close": 1.8333,
    "volume": 9783000.0
  },
  {
    "Unnamed: 0": 174,
    "time": 1305504000,
    "open": 1.85,
    "high": 1.866,
    "low": 1.77,
    "close": 1.7787,
    "volume": 11152500.0
  },
  {
    "Unnamed: 0": 175,
    "time": 1305590400,
    "open": 1.85,
    "high": 1.85,
    "low": 1.7147,
    "close": 1.722,
    "volume": 18295500.0
  },
  {
    "Unnamed: 0": 176,
    "time": 1305676800,
    "open": 1.6967,
    "high": 1.7647,
    "low": 1.6967,
    "close": 1.7567,
    "volume": 10804500.0
  },
  {
    "Unnamed: 0": 177,
    "time": 1305763200,
    "open": 1.7793,
    "high": 1.896,
    "low": 1.7733,
    "close": 1.8533,
    "volume": 38518500.0
  },
  {
    "Unnamed: 0": 178,
    "time": 1305849600,
    "open": 1.8867,
    "high": 1.8867,
    "low": 1.8233,
    "close": 1.8653,
    "volume": 12024000.0
  },
  {
    "Unnamed: 0": 179,
    "time": 1306108800,
    "open": 1.8333,
    "high": 1.8413,
    "low": 1.7747,
    "close": 1.776,
    "volume": 12774000.0
  },
  {
    "Unnamed: 0": 180,
    "time": 1306195200,
    "open": 1.8107,
    "high": 1.8333,
    "low": 1.77,
    "close": 1.77,
    "volume": 9003000.0
  },
  {
    "Unnamed: 0": 181,
    "time": 1306281600,
    "open": 1.7987,
    "high": 1.934,
    "low": 1.7447,
    "close": 1.926,
    "volume": 69592500.0
  },
  {
    "Unnamed: 0": 182,
    "time": 1306368000,
    "open": 1.9307,
    "high": 1.984,
    "low": 1.8733,
    "close": 1.9667,
    "volume": 48706500.0
  },
  {
    "Unnamed: 0": 183,
    "time": 1306454400,
    "open": 1.9707,
    "high": 1.978,
    "low": 1.9213,
    "close": 1.964,
    "volume": 24933000.0
  },
  {
    "Unnamed: 0": 184,
    "time": 1306800000,
    "open": 1.9747,
    "high": 2.0187,
    "low": 1.9667,
    "close": 2.0127,
    "volume": 48790500.0
  },
  {
    "Unnamed: 0": 185,
    "time": 1306886400,
    "open": 2.0093,
    "high": 2.0093,
    "low": 1.884,
    "close": 1.904,
    "volume": 22666500.0
  },
  {
    "Unnamed: 0": 186,
    "time": 1306972800,
    "open": 1.908,
    "high": 1.9547,
    "low": 1.8893,
    "close": 1.95,
    "volume": 14418000.0
  },
  {
    "Unnamed: 0": 187,
    "time": 1307059200,
    "open": 1.9367,
    "high": 2.1,
    "low": 1.9327,
    "close": 2.0,
    "volume": 92074500.0
  },
  {
    "Unnamed: 0": 188,
    "time": 1307318400,
    "open": 2.012,
    "high": 2.0253,
    "low": 1.884,
    "close": 1.9167,
    "volume": 34503000.0
  },
  {
    "Unnamed: 0": 189,
    "time": 1307404800,
    "open": 1.928,
    "high": 1.9593,
    "low": 1.884,
    "close": 1.89,
    "volume": 17590500.0
  },
  {
    "Unnamed: 0": 190,
    "time": 1307491200,
    "open": 1.8813,
    "high": 1.9067,
    "low": 1.8,
    "close": 1.8073,
    "volume": 25230000.0
  },
  {
    "Unnamed: 0": 191,
    "time": 1307577600,
    "open": 1.8313,
    "high": 1.8733,
    "low": 1.8067,
    "close": 1.8553,
    "volume": 23793000.0
  },
  {
    "Unnamed: 0": 192,
    "time": 1307664000,
    "open": 1.8313,
    "high": 1.8867,
    "low": 1.8233,
    "close": 1.868,
    "volume": 22432500.0
  },
  {
    "Unnamed: 0": 193,
    "time": 1307923200,
    "open": 1.8713,
    "high": 1.9253,
    "low": 1.8587,
    "close": 1.8967,
    "volume": 25342500.0
  },
  {
    "Unnamed: 0": 194,
    "time": 1308009600,
    "open": 1.928,
    "high": 1.98,
    "low": 1.9,
    "close": 1.9,
    "volume": 23337000.0
  },
  {
    "Unnamed: 0": 195,
    "time": 1308096000,
    "open": 1.9,
    "high": 1.9,
    "low": 1.8047,
    "close": 1.8533,
    "volume": 19891500.0
  },
  {
    "Unnamed: 0": 196,
    "time": 1308182400,
    "open": 1.8447,
    "high": 1.8667,
    "low": 1.716,
    "close": 1.7487,
    "volume": 26997000.0
  },
  {
    "Unnamed: 0": 197,
    "time": 1308268800,
    "open": 1.778,
    "high": 1.8467,
    "low": 1.7427,
    "close": 1.766,
    "volume": 25465500.0
  },
  {
    "Unnamed: 0": 198,
    "time": 1308528000,
    "open": 1.7733,
    "high": 1.7733,
    "low": 1.7,
    "close": 1.734,
    "volume": 22590000.0
  },
  {
    "Unnamed: 0": 199,
    "time": 1308614400,
    "open": 1.7513,
    "high": 1.8487,
    "low": 1.7333,
    "close": 1.8447,
    "volume": 22168500.0
  },
  {
    "Unnamed: 0": 200,
    "time": 1308700800,
    "open": 1.828,
    "high": 1.8833,
    "low": 1.802,
    "close": 1.802,
    "volume": 21912000.0
  },
  {
    "Unnamed: 0": 201,
    "time": 1308787200,
    "open": 1.8053,
    "high": 1.856,
    "low": 1.7473,
    "close": 1.856,
    "volume": 17314500.0
  },
  {
    "Unnamed: 0": 202,
    "time": 1308873600,
    "open": 1.8427,
    "high": 1.8647,
    "low": 1.8173,
    "close": 1.8373,
    "volume": 49531500.0
  },
  {
    "Unnamed: 0": 203,
    "time": 1309132800,
    "open": 1.8487,
    "high": 1.8853,
    "low": 1.8207,
    "close": 1.8307,
    "volume": 16056000.0
  },
  {
    "Unnamed: 0": 204,
    "time": 1309219200,
    "open": 1.852,
    "high": 1.8833,
    "low": 1.8447,
    "close": 1.874,
    "volume": 13153500.0
  },
  {
    "Unnamed: 0": 205,
    "time": 1309305600,
    "open": 1.8887,
    "high": 1.9393,
    "low": 1.8713,
    "close": 1.8873,
    "volume": 21499500.0
  },
  {
    "Unnamed: 0": 206,
    "time": 1309392000,
    "open": 1.9,
    "high": 1.9553,
    "low": 1.886,
    "close": 1.912,
    "volume": 13981500.0
  },
  {
    "Unnamed: 0": 207,
    "time": 1309478400,
    "open": 1.938,
    "high": 1.9733,
    "low": 1.92,
    "close": 1.9347,
    "volume": 12570000.0
  },
  {
    "Unnamed: 0": 208,
    "time": 1309824000,
    "open": 1.9347,
    "high": 1.968,
    "low": 1.914,
    "close": 1.942,
    "volume": 14746500.0
  },
  {
    "Unnamed: 0": 209,
    "time": 1309910400,
    "open": 1.9633,
    "high": 1.9633,
    "low": 1.9033,
    "close": 1.926,
    "volume": 13030500.0
  },
  {
    "Unnamed: 0": 210,
    "time": 1309996800,
    "open": 1.9427,
    "high": 2.0,
    "low": 1.934,
    "close": 1.982,
    "volume": 19233000.0
  },
  {
    "Unnamed: 0": 211,
    "time": 1310083200,
    "open": 1.9733,
    "high": 1.9927,
    "low": 1.906,
    "close": 1.916,
    "volume": 18363000.0
  },
  {
    "Unnamed: 0": 212,
    "time": 1310342400,
    "open": 1.9073,
    "high": 1.9073,
    "low": 1.8667,
    "close": 1.8893,
    "volume": 14514000.0
  },
  {
    "Unnamed: 0": 213,
    "time": 1310428800,
    "open": 1.8667,
    "high": 1.9393,
    "low": 1.8667,
    "close": 1.8667,
    "volume": 15451500.0
  },
  {
    "Unnamed: 0": 214,
    "time": 1310515200,
    "open": 1.8953,
    "high": 1.9353,
    "low": 1.86,
    "close": 1.9113,
    "volume": 15813000.0
  },
  {
    "Unnamed: 0": 215,
    "time": 1310601600,
    "open": 1.902,
    "high": 1.9307,
    "low": 1.8167,
    "close": 1.8407,
    "volume": 17193000.0
  },
  {
    "Unnamed: 0": 216,
    "time": 1310688000,
    "open": 1.8527,
    "high": 1.8553,
    "low": 1.8267,
    "close": 1.8353,
    "volume": 10407000.0
  },
  {
    "Unnamed: 0": 217,
    "time": 1310947200,
    "open": 1.832,
    "high": 1.85,
    "low": 1.7753,
    "close": 1.7953,
    "volume": 12657000.0
  },
  {
    "Unnamed: 0": 218,
    "time": 1311033600,
    "open": 1.8153,
    "high": 1.874,
    "low": 1.8153,
    "close": 1.86,
    "volume": 14488500.0
  },
  {
    "Unnamed: 0": 219,
    "time": 1311120000,
    "open": 1.8667,
    "high": 2.0293,
    "low": 1.8533,
    "close": 1.9187,
    "volume": 45171000.0
  },
  {
    "Unnamed: 0": 220,
    "time": 1311206400,
    "open": 1.9,
    "high": 1.944,
    "low": 1.8733,
    "close": 1.914,
    "volume": 14995500.0
  },
  {
    "Unnamed: 0": 221,
    "time": 1311292800,
    "open": 1.9133,
    "high": 1.9693,
    "low": 1.9033,
    "close": 1.9507,
    "volume": 8658000.0
  },
  {
    "Unnamed: 0": 222,
    "time": 1311552000,
    "open": 1.8913,
    "high": 1.9527,
    "low": 1.8733,
    "close": 1.9173,
    "volume": 9960000.0
  },
  {
    "Unnamed: 0": 223,
    "time": 1311638400,
    "open": 1.86,
    "high": 1.918,
    "low": 1.86,
    "close": 1.878,
    "volume": 11218500.0
  },
  {
    "Unnamed: 0": 224,
    "time": 1311724800,
    "open": 1.9,
    "high": 1.9,
    "low": 1.8273,
    "close": 1.842,
    "volume": 13981500.0
  },
  {
    "Unnamed: 0": 225,
    "time": 1311811200,
    "open": 1.846,
    "high": 1.9033,
    "low": 1.836,
    "close": 1.8653,
    "volume": 13846500.0
  },
  {
    "Unnamed: 0": 226,
    "time": 1311897600,
    "open": 1.8533,
    "high": 1.8933,
    "low": 1.8333,
    "close": 1.878,
    "volume": 13464000.0
  },
  {
    "Unnamed: 0": 227,
    "time": 1312156800,
    "open": 1.9233,
    "high": 1.932,
    "low": 1.8807,
    "close": 1.918,
    "volume": 16134000.0
  },
  {
    "Unnamed: 0": 228,
    "time": 1312243200,
    "open": 1.9127,
    "high": 1.9467,
    "low": 1.8,
    "close": 1.8,
    "volume": 21258000.0
  },
  {
    "Unnamed: 0": 229,
    "time": 1312329600,
    "open": 1.8333,
    "high": 1.9333,
    "low": 1.75,
    "close": 1.75,
    "volume": 25755000.0
  },
  {
    "Unnamed: 0": 230,
    "time": 1312416000,
    "open": 1.7567,
    "high": 1.7927,
    "low": 1.6447,
    "close": 1.6833,
    "volume": 44475000.0
  },
  {
    "Unnamed: 0": 231,
    "time": 1312502400,
    "open": 1.6433,
    "high": 1.692,
    "low": 1.522,
    "close": 1.6167,
    "volume": 28983000.0
  },
  {
    "Unnamed: 0": 232,
    "time": 1312761600,
    "open": 1.5167,
    "high": 1.6293,
    "low": 1.496,
    "close": 1.572,
    "volume": 38667000.0
  },
  {
    "Unnamed: 0": 233,
    "time": 1312848000,
    "open": 1.5727,
    "high": 1.6967,
    "low": 1.5667,
    "close": 1.6707,
    "volume": 19720500.0
  },
  {
    "Unnamed: 0": 234,
    "time": 1312934400,
    "open": 1.6907,
    "high": 1.696,
    "low": 1.5753,
    "close": 1.6707,
    "volume": 22410000.0
  },
  {
    "Unnamed: 0": 235,
    "time": 1313020800,
    "open": 1.63,
    "high": 1.7167,
    "low": 1.6,
    "close": 1.6867,
    "volume": 12295500.0
  },
  {
    "Unnamed: 0": 236,
    "time": 1313107200,
    "open": 1.7067,
    "high": 1.8093,
    "low": 1.6907,
    "close": 1.754,
    "volume": 14947500.0
  },
  {
    "Unnamed: 0": 237,
    "time": 1313366400,
    "open": 1.77,
    "high": 1.7833,
    "low": 1.7287,
    "close": 1.7493,
    "volume": 10935000.0
  },
  {
    "Unnamed: 0": 238,
    "time": 1313452800,
    "open": 1.7467,
    "high": 1.7693,
    "low": 1.722,
    "close": 1.7393,
    "volume": 7972500.0
  },
  {
    "Unnamed: 0": 239,
    "time": 1313539200,
    "open": 1.7573,
    "high": 1.7767,
    "low": 1.6847,
    "close": 1.6867,
    "volume": 9489000.0
  },
  {
    "Unnamed: 0": 240,
    "time": 1313625600,
    "open": 1.7,
    "high": 1.7,
    "low": 1.5647,
    "close": 1.6173,
    "volume": 15598500.0
  },
  {
    "Unnamed: 0": 241,
    "time": 1313712000,
    "open": 1.564,
    "high": 1.6173,
    "low": 1.4667,
    "close": 1.49,
    "volume": 18744000.0
  },
  {
    "Unnamed: 0": 242,
    "time": 1313971200,
    "open": 1.498,
    "high": 1.5867,
    "low": 1.4453,
    "close": 1.4633,
    "volume": 14208000.0
  },
  {
    "Unnamed: 0": 243,
    "time": 1314057600,
    "open": 1.48,
    "high": 1.5407,
    "low": 1.4333,
    "close": 1.4633,
    "volume": 12903000.0
  },
  {
    "Unnamed: 0": 244,
    "time": 1314144000,
    "open": 1.5333,
    "high": 1.5953,
    "low": 1.508,
    "close": 1.5307,
    "volume": 10108500.0
  },
  {
    "Unnamed: 0": 245,
    "time": 1314230400,
    "open": 1.5913,
    "high": 1.5913,
    "low": 1.5267,
    "close": 1.55,
    "volume": 10123500.0
  },
  {
    "Unnamed: 0": 246,
    "time": 1314316800,
    "open": 1.514,
    "high": 1.5967,
    "low": 1.4713,
    "close": 1.582,
    "volume": 11325000.0
  },
  {
    "Unnamed: 0": 247,
    "time": 1314576000,
    "open": 1.596,
    "high": 1.6567,
    "low": 1.596,
    "close": 1.6473,
    "volume": 11877000.0
  },
  {
    "Unnamed: 0": 248,
    "time": 1314662400,
    "open": 1.6333,
    "high": 1.652,
    "low": 1.606,
    "close": 1.64,
    "volume": 5392500.0
  },
  {
    "Unnamed: 0": 249,
    "time": 1314748800,
    "open": 1.6453,
    "high": 1.7,
    "low": 1.6187,
    "close": 1.646,
    "volume": 12174000.0
  },
  {
    "Unnamed: 0": 250,
    "time": 1314835200,
    "open": 1.644,
    "high": 1.658,
    "low": 1.5893,
    "close": 1.6,
    "volume": 12555000.0
  },
  {
    "Unnamed: 0": 251,
    "time": 1314921600,
    "open": 1.6,
    "high": 1.6,
    "low": 1.512,
    "close": 1.5713,
    "volume": 11379000.0
  },
  {
    "Unnamed: 0": 252,
    "time": 1315267200,
    "open": 1.5067,
    "high": 1.5467,
    "low": 1.486,
    "close": 1.51,
    "volume": 11688000.0
  },
  {
    "Unnamed: 0": 253,
    "time": 1315353600,
    "open": 1.6,
    "high": 1.6,
    "low": 1.552,
    "close": 1.5893,
    "volume": 6774000.0
  },
  {
    "Unnamed: 0": 254,
    "time": 1315440000,
    "open": 1.572,
    "high": 1.602,
    "low": 1.552,
    "close": 1.5893,
    "volume": 6633000.0
  },
  {
    "Unnamed: 0": 255,
    "time": 1315526400,
    "open": 1.558,
    "high": 1.574,
    "low": 1.5033,
    "close": 1.5313,
    "volume": 9963000.0
  },
  {
    "Unnamed: 0": 256,
    "time": 1315785600,
    "open": 1.4987,
    "high": 1.554,
    "low": 1.4967,
    "close": 1.5253,
    "volume": 8395500.0
  },
  {
    "Unnamed: 0": 257,
    "time": 1315872000,
    "open": 1.5527,
    "high": 1.6067,
    "low": 1.5167,
    "close": 1.6053,
    "volume": 10750500.0
  },
  {
    "Unnamed: 0": 258,
    "time": 1315958400,
    "open": 1.6133,
    "high": 1.656,
    "low": 1.586,
    "close": 1.6227,
    "volume": 12340500.0
  },
  {
    "Unnamed: 0": 259,
    "time": 1316044800,
    "open": 1.6387,
    "high": 1.662,
    "low": 1.622,
    "close": 1.6227,
    "volume": 8277000.0
  },
  {
    "Unnamed: 0": 260,
    "time": 1316131200,
    "open": 1.6533,
    "high": 1.73,
    "low": 1.6327,
    "close": 1.73,
    "volume": 20959500.0
  },
  {
    "Unnamed: 0": 261,
    "time": 1316390400,
    "open": 1.7113,
    "high": 1.7207,
    "low": 1.588,
    "close": 1.7173,
    "volume": 17196000.0
  },
  {
    "Unnamed: 0": 262,
    "time": 1316476800,
    "open": 1.7133,
    "high": 1.7733,
    "low": 1.7113,
    "close": 1.7267,
    "volume": 16471500.0
  },
  {
    "Unnamed: 0": 263,
    "time": 1316563200,
    "open": 1.73,
    "high": 1.7967,
    "low": 1.7133,
    "close": 1.7233,
    "volume": 14565000.0
  },
  {
    "Unnamed: 0": 264,
    "time": 1316649600,
    "open": 1.6933,
    "high": 1.7407,
    "low": 1.6187,
    "close": 1.7093,
    "volume": 11467500.0
  },
  {
    "Unnamed: 0": 265,
    "time": 1316736000,
    "open": 1.6993,
    "high": 1.7747,
    "low": 1.69,
    "close": 1.7547,
    "volume": 16702500.0
  },
  {
    "Unnamed: 0": 266,
    "time": 1316995200,
    "open": 1.768,
    "high": 1.768,
    "low": 1.66,
    "close": 1.7133,
    "volume": 13869000.0
  },
  {
    "Unnamed: 0": 267,
    "time": 1317081600,
    "open": 1.7133,
    "high": 1.7993,
    "low": 1.7013,
    "close": 1.746,
    "volume": 9808500.0
  },
  {
    "Unnamed: 0": 268,
    "time": 1317168000,
    "open": 1.75,
    "high": 1.7667,
    "low": 1.634,
    "close": 1.6393,
    "volume": 10636500.0
  },
  {
    "Unnamed: 0": 269,
    "time": 1317254400,
    "open": 1.6667,
    "high": 1.7213,
    "low": 1.57,
    "close": 1.608,
    "volume": 12891000.0
  },
  {
    "Unnamed: 0": 270,
    "time": 1317340800,
    "open": 1.6533,
    "high": 1.6593,
    "low": 1.566,
    "close": 1.6253,
    "volume": 19627500.0
  },
  {
    "Unnamed: 0": 271,
    "time": 1317600000,
    "open": 1.6127,
    "high": 1.6667,
    "low": 1.55,
    "close": 1.582,
    "volume": 15189000.0
  },
  {
    "Unnamed: 0": 272,
    "time": 1317686400,
    "open": 1.5493,
    "high": 1.6213,
    "low": 1.5287,
    "close": 1.5773,
    "volume": 17628000.0
  },
  {
    "Unnamed: 0": 273,
    "time": 1317772800,
    "open": 1.5967,
    "high": 1.7227,
    "low": 1.5567,
    "close": 1.692,
    "volume": 17782500.0
  },
  {
    "Unnamed: 0": 274,
    "time": 1317859200,
    "open": 1.6913,
    "high": 1.84,
    "low": 1.668,
    "close": 1.7973,
    "volume": 24651000.0
  },
  {
    "Unnamed: 0": 275,
    "time": 1317945600,
    "open": 1.7447,
    "high": 1.84,
    "low": 1.7367,
    "close": 1.7993,
    "volume": 19497000.0
  },
  {
    "Unnamed: 0": 276,
    "time": 1318204800,
    "open": 1.816,
    "high": 1.8787,
    "low": 1.8,
    "close": 1.8587,
    "volume": 12903000.0
  },
  {
    "Unnamed: 0": 277,
    "time": 1318291200,
    "open": 1.834,
    "high": 1.8513,
    "low": 1.8,
    "close": 1.8,
    "volume": 8533500.0
  },
  {
    "Unnamed: 0": 278,
    "time": 1318377600,
    "open": 1.8427,
    "high": 1.8667,
    "low": 1.8133,
    "close": 1.8533,
    "volume": 16698000.0
  },
  {
    "Unnamed: 0": 279,
    "time": 1318464000,
    "open": 1.8353,
    "high": 1.898,
    "low": 1.8293,
    "close": 1.8327,
    "volume": 15391500.0
  },
  {
    "Unnamed: 0": 280,
    "time": 1318550400,
    "open": 1.88,
    "high": 1.9033,
    "low": 1.8173,
    "close": 1.87,
    "volume": 20578500.0
  },
  {
    "Unnamed: 0": 281,
    "time": 1318809600,
    "open": 1.8727,
    "high": 1.8733,
    "low": 1.8173,
    "close": 1.828,
    "volume": 11227500.0
  },
  {
    "Unnamed: 0": 282,
    "time": 1318896000,
    "open": 1.82,
    "high": 1.8953,
    "low": 1.7807,
    "close": 1.89,
    "volume": 14308500.0
  },
  {
    "Unnamed: 0": 283,
    "time": 1318982400,
    "open": 1.8667,
    "high": 1.872,
    "low": 1.82,
    "close": 1.838,
    "volume": 11691000.0
  },
  {
    "Unnamed: 0": 284,
    "time": 1319068800,
    "open": 1.8333,
    "high": 1.8333,
    "low": 1.8,
    "close": 1.8133,
    "volume": 14899500.0
  },
  {
    "Unnamed: 0": 285,
    "time": 1319155200,
    "open": 1.718,
    "high": 1.8867,
    "low": 1.718,
    "close": 1.8687,
    "volume": 14001000.0
  },
  {
    "Unnamed: 0": 286,
    "time": 1319414400,
    "open": 1.8593,
    "high": 1.926,
    "low": 1.85,
    "close": 1.904,
    "volume": 13860000.0
  },
  {
    "Unnamed: 0": 287,
    "time": 1319500800,
    "open": 1.882,
    "high": 1.924,
    "low": 1.8533,
    "close": 1.9033,
    "volume": 9043500.0
  },
  {
    "Unnamed: 0": 288,
    "time": 1319587200,
    "open": 1.882,
    "high": 1.8913,
    "low": 1.8267,
    "close": 1.8653,
    "volume": 7510500.0
  },
  {
    "Unnamed: 0": 289,
    "time": 1319673600,
    "open": 1.892,
    "high": 1.9333,
    "low": 1.8653,
    "close": 1.9333,
    "volume": 12655500.0
  },
  {
    "Unnamed: 0": 290,
    "time": 1319760000,
    "open": 1.9473,
    "high": 2.0167,
    "low": 1.8673,
    "close": 2.0167,
    "volume": 18213000.0
  },
  {
    "Unnamed: 0": 291,
    "time": 1320019200,
    "open": 1.9667,
    "high": 1.9673,
    "low": 1.9167,
    "close": 1.958,
    "volume": 16635000.0
  },
  {
    "Unnamed: 0": 292,
    "time": 1320105600,
    "open": 1.9167,
    "high": 1.958,
    "low": 1.8667,
    "close": 1.9033,
    "volume": 9394500.0
  },
  {
    "Unnamed: 0": 293,
    "time": 1320192000,
    "open": 1.948,
    "high": 2.0553,
    "low": 1.8833,
    "close": 2.0167,
    "volume": 12871500.0
  },
  {
    "Unnamed: 0": 294,
    "time": 1320278400,
    "open": 1.9993,
    "high": 2.1667,
    "low": 1.9687,
    "close": 2.1473,
    "volume": 36706500.0
  },
  {
    "Unnamed: 0": 295,
    "time": 1320364800,
    "open": 2.1167,
    "high": 2.164,
    "low": 2.034,
    "close": 2.1533,
    "volume": 43872000.0
  },
  {
    "Unnamed: 0": 296,
    "time": 1320624000,
    "open": 2.1367,
    "high": 2.1487,
    "low": 2.05,
    "close": 2.09,
    "volume": 18619500.0
  },
  {
    "Unnamed: 0": 297,
    "time": 1320710400,
    "open": 2.0867,
    "high": 2.1333,
    "low": 2.048,
    "close": 2.0947,
    "volume": 15342000.0
  },
  {
    "Unnamed: 0": 298,
    "time": 1320796800,
    "open": 2.08,
    "high": 2.0993,
    "low": 2.02,
    "close": 2.0567,
    "volume": 14122500.0
  },
  {
    "Unnamed: 0": 299,
    "time": 1320883200,
    "open": 2.0747,
    "high": 2.1,
    "low": 2.0433,
    "close": 2.074,
    "volume": 11065500.0
  },
  {
    "Unnamed: 0": 300,
    "time": 1320969600,
    "open": 2.16,
    "high": 2.3,
    "low": 2.038,
    "close": 2.2667,
    "volume": 56487000.0
  },
  {
    "Unnamed: 0": 301,
    "time": 1321228800,
    "open": 2.2347,
    "high": 2.2427,
    "low": 2.1747,
    "close": 2.214,
    "volume": 18837000.0
  },
  {
    "Unnamed: 0": 302,
    "time": 1321315200,
    "open": 2.2,
    "high": 2.2933,
    "low": 2.182,
    "close": 2.2547,
    "volume": 13186500.0
  },
  {
    "Unnamed: 0": 303,
    "time": 1321401600,
    "open": 2.2533,
    "high": 2.3333,
    "low": 2.2267,
    "close": 2.318,
    "volume": 26086500.0
  },
  {
    "Unnamed: 0": 304,
    "time": 1321488000,
    "open": 2.318,
    "high": 2.3267,
    "low": 2.2127,
    "close": 2.2453,
    "volume": 20025000.0
  },
  {
    "Unnamed: 0": 305,
    "time": 1321574400,
    "open": 2.2667,
    "high": 2.274,
    "low": 2.1633,
    "close": 2.1633,
    "volume": 13359000.0
  },
  {
    "Unnamed: 0": 306,
    "time": 1321833600,
    "open": 2.1733,
    "high": 2.1733,
    "low": 2.07,
    "close": 2.108,
    "volume": 15288000.0
  },
  {
    "Unnamed: 0": 307,
    "time": 1321920000,
    "open": 2.1173,
    "high": 2.186,
    "low": 2.07,
    "close": 2.138,
    "volume": 10806000.0
  },
  {
    "Unnamed: 0": 308,
    "time": 1322006400,
    "open": 2.1173,
    "high": 2.1367,
    "low": 2.0833,
    "close": 2.0967,
    "volume": 6690000.0
  },
  {
    "Unnamed: 0": 309,
    "time": 1322179200,
    "open": 2.092,
    "high": 2.1607,
    "low": 2.072,
    "close": 2.1333,
    "volume": 3430500.0
  },
  {
    "Unnamed: 0": 310,
    "time": 1322438400,
    "open": 2.1267,
    "high": 2.2187,
    "low": 2.1207,
    "close": 2.1707,
    "volume": 10074000.0
  },
  {
    "Unnamed: 0": 311,
    "time": 1322524800,
    "open": 2.1707,
    "high": 2.2047,
    "low": 2.1087,
    "close": 2.1707,
    "volume": 8560500.0
  },
  {
    "Unnamed: 0": 312,
    "time": 1322611200,
    "open": 2.1333,
    "high": 2.1953,
    "low": 2.1333,
    "close": 2.182,
    "volume": 11122500.0
  },
  {
    "Unnamed: 0": 313,
    "time": 1322697600,
    "open": 2.1713,
    "high": 2.266,
    "low": 2.132,
    "close": 2.194,
    "volume": 14413500.0
  },
  {
    "Unnamed: 0": 314,
    "time": 1322784000,
    "open": 2.1773,
    "high": 2.246,
    "low": 2.16,
    "close": 2.2053,
    "volume": 10338000.0
  },
  {
    "Unnamed: 0": 315,
    "time": 1323043200,
    "open": 2.236,
    "high": 2.3333,
    "low": 2.2287,
    "close": 2.294,
    "volume": 15996000.0
  },
  {
    "Unnamed: 0": 316,
    "time": 1323129600,
    "open": 2.28,
    "high": 2.332,
    "low": 2.2687,
    "close": 2.3173,
    "volume": 14083500.0
  },
  {
    "Unnamed: 0": 317,
    "time": 1323216000,
    "open": 2.3107,
    "high": 2.326,
    "low": 2.2533,
    "close": 2.2793,
    "volume": 9607500.0
  },
  {
    "Unnamed: 0": 318,
    "time": 1323302400,
    "open": 2.236,
    "high": 2.236,
    "low": 1.974,
    "close": 2.0633,
    "volume": 48607500.0
  },
  {
    "Unnamed: 0": 319,
    "time": 1323388800,
    "open": 2.0867,
    "high": 2.09,
    "low": 2.0187,
    "close": 2.07,
    "volume": 18294000.0
  },
  {
    "Unnamed: 0": 320,
    "time": 1323648000,
    "open": 2.03,
    "high": 2.0413,
    "low": 2.0013,
    "close": 2.0273,
    "volume": 11262000.0
  },
  {
    "Unnamed: 0": 321,
    "time": 1323734400,
    "open": 2.0353,
    "high": 2.062,
    "low": 1.9273,
    "close": 2.0273,
    "volume": 14616000.0
  },
  {
    "Unnamed: 0": 322,
    "time": 1323820800,
    "open": 1.9667,
    "high": 1.9787,
    "low": 1.8667,
    "close": 1.9,
    "volume": 17221500.0
  },
  {
    "Unnamed: 0": 323,
    "time": 1323907200,
    "open": 1.9073,
    "high": 1.9447,
    "low": 1.8747,
    "close": 1.908,
    "volume": 10383000.0
  },
  {
    "Unnamed: 0": 324,
    "time": 1323993600,
    "open": 2.0627,
    "high": 2.0627,
    "low": 1.8653,
    "close": 1.8667,
    "volume": 14853000.0
  },
  {
    "Unnamed: 0": 325,
    "time": 1324252800,
    "open": 1.872,
    "high": 1.9,
    "low": 1.8247,
    "close": 1.85,
    "volume": 14272500.0
  },
  {
    "Unnamed: 0": 326,
    "time": 1324339200,
    "open": 1.8667,
    "high": 1.8967,
    "low": 1.8467,
    "close": 1.888,
    "volume": 12039000.0
  },
  {
    "Unnamed: 0": 327,
    "time": 1324425600,
    "open": 1.88,
    "high": 1.88,
    "low": 1.7353,
    "close": 1.8667,
    "volume": 25294500.0
  },
  {
    "Unnamed: 0": 328,
    "time": 1324512000,
    "open": 1.8327,
    "high": 1.87,
    "low": 1.8,
    "close": 1.866,
    "volume": 14973000.0
  },
  {
    "Unnamed: 0": 329,
    "time": 1324598400,
    "open": 1.8653,
    "high": 1.8667,
    "low": 1.8347,
    "close": 1.8633,
    "volume": 8787000.0
  },
  {
    "Unnamed: 0": 330,
    "time": 1324944000,
    "open": 1.86,
    "high": 1.918,
    "low": 1.8367,
    "close": 1.86,
    "volume": 10927500.0
  },
  {
    "Unnamed: 0": 331,
    "time": 1325030400,
    "open": 1.9267,
    "high": 1.9493,
    "low": 1.8693,
    "close": 1.9047,
    "volume": 8535000.0
  },
  {
    "Unnamed: 0": 332,
    "time": 1325116800,
    "open": 1.906,
    "high": 1.956,
    "low": 1.9007,
    "close": 1.9007,
    "volume": 7056000.0
  },
  {
    "Unnamed: 0": 333,
    "time": 1325203200,
    "open": 1.8993,
    "high": 1.932,
    "low": 1.8833,
    "close": 1.904,
    "volume": 4962000.0
  },
  {
    "Unnamed: 0": 334,
    "time": 1325548800,
    "open": 1.9233,
    "high": 1.9667,
    "low": 1.8433,
    "close": 1.872,
    "volume": 13644000.0
  },
  {
    "Unnamed: 0": 335,
    "time": 1325635200,
    "open": 1.9053,
    "high": 1.9113,
    "low": 1.8333,
    "close": 1.8473,
    "volume": 9174000.0
  },
  {
    "Unnamed: 0": 336,
    "time": 1325721600,
    "open": 1.8507,
    "high": 1.862,
    "low": 1.79,
    "close": 1.808,
    "volume": 14919000.0
  },
  {
    "Unnamed: 0": 337,
    "time": 1325808000,
    "open": 1.814,
    "high": 1.8527,
    "low": 1.7607,
    "close": 1.808,
    "volume": 14559000.0
  },
  {
    "Unnamed: 0": 338,
    "time": 1326067200,
    "open": 1.8,
    "high": 1.8327,
    "low": 1.7413,
    "close": 1.8127,
    "volume": 13207500.0
  },
  {
    "Unnamed: 0": 339,
    "time": 1326153600,
    "open": 1.8293,
    "high": 1.8507,
    "low": 1.8167,
    "close": 1.85,
    "volume": 9924000.0
  },
  {
    "Unnamed: 0": 340,
    "time": 1326240000,
    "open": 1.8587,
    "high": 1.9113,
    "low": 1.82,
    "close": 1.9113,
    "volume": 9738000.0
  },
  {
    "Unnamed: 0": 341,
    "time": 1326326400,
    "open": 1.8987,
    "high": 1.908,
    "low": 1.8533,
    "close": 1.8833,
    "volume": 9886500.0
  },
  {
    "Unnamed: 0": 342,
    "time": 1326412800,
    "open": 1.8933,
    "high": 1.9,
    "low": 1.5093,
    "close": 1.6373,
    "volume": 80587500.0
  },
  {
    "Unnamed: 0": 343,
    "time": 1326758400,
    "open": 1.7033,
    "high": 1.8227,
    "low": 1.6767,
    "close": 1.7667,
    "volume": 68454000.0
  },
  {
    "Unnamed: 0": 344,
    "time": 1326844800,
    "open": 1.7667,
    "high": 1.7993,
    "low": 1.75,
    "close": 1.7873,
    "volume": 17664000.0
  },
  {
    "Unnamed: 0": 345,
    "time": 1326931200,
    "open": 1.8,
    "high": 1.8493,
    "low": 1.774,
    "close": 1.7787,
    "volume": 18375000.0
  },
  {
    "Unnamed: 0": 346,
    "time": 1327017600,
    "open": 1.7933,
    "high": 1.8,
    "low": 1.7507,
    "close": 1.7507,
    "volume": 9475500.0
  },
  {
    "Unnamed: 0": 347,
    "time": 1327276800,
    "open": 1.79,
    "high": 1.814,
    "low": 1.7733,
    "close": 1.788,
    "volume": 8737500.0
  },
  {
    "Unnamed: 0": 348,
    "time": 1327363200,
    "open": 1.7753,
    "high": 1.8453,
    "low": 1.7627,
    "close": 1.8133,
    "volume": 12381000.0
  },
  {
    "Unnamed: 0": 349,
    "time": 1327449600,
    "open": 1.8133,
    "high": 1.8673,
    "low": 1.8033,
    "close": 1.8647,
    "volume": 8737500.0
  },
  {
    "Unnamed: 0": 350,
    "time": 1327536000,
    "open": 1.8667,
    "high": 1.972,
    "low": 1.8647,
    "close": 1.8647,
    "volume": 17626500.0
  },
  {
    "Unnamed: 0": 351,
    "time": 1327622400,
    "open": 1.9,
    "high": 1.9813,
    "low": 1.9,
    "close": 1.9487,
    "volume": 10332000.0
  },
  {
    "Unnamed: 0": 352,
    "time": 1327881600,
    "open": 1.966,
    "high": 1.974,
    "low": 1.902,
    "close": 1.974,
    "volume": 10779000.0
  },
  {
    "Unnamed: 0": 353,
    "time": 1327968000,
    "open": 2.0,
    "high": 2.0333,
    "low": 1.9247,
    "close": 1.9387,
    "volume": 13840500.0
  },
  {
    "Unnamed: 0": 354,
    "time": 1328054400,
    "open": 1.9333,
    "high": 1.98,
    "low": 1.9207,
    "close": 1.964,
    "volume": 7369500.0
  },
  {
    "Unnamed: 0": 355,
    "time": 1328140800,
    "open": 1.9813,
    "high": 2.0587,
    "low": 1.9727,
    "close": 1.9727,
    "volume": 11790000.0
  },
  {
    "Unnamed: 0": 356,
    "time": 1328227200,
    "open": 2.032,
    "high": 2.0887,
    "low": 2.0167,
    "close": 2.074,
    "volume": 11242500.0
  },
  {
    "Unnamed: 0": 357,
    "time": 1328486400,
    "open": 2.0667,
    "high": 2.1267,
    "low": 2.066,
    "close": 2.12,
    "volume": 9498000.0
  },
  {
    "Unnamed: 0": 358,
    "time": 1328572800,
    "open": 2.1167,
    "high": 2.142,
    "low": 2.0547,
    "close": 2.1067,
    "volume": 14199000.0
  },
  {
    "Unnamed: 0": 359,
    "time": 1328659200,
    "open": 2.1333,
    "high": 2.134,
    "low": 2.086,
    "close": 2.1207,
    "volume": 9072000.0
  },
  {
    "Unnamed: 0": 360,
    "time": 1328745600,
    "open": 2.1287,
    "high": 2.2467,
    "low": 2.0953,
    "close": 2.1853,
    "volume": 17317500.0
  },
  {
    "Unnamed: 0": 361,
    "time": 1328832000,
    "open": 2.158,
    "high": 2.1613,
    "low": 1.9893,
    "close": 2.0733,
    "volume": 27693000.0
  },
  {
    "Unnamed: 0": 362,
    "time": 1329091200,
    "open": 2.0907,
    "high": 2.1373,
    "low": 2.06,
    "close": 2.094,
    "volume": 16954500.0
  },
  {
    "Unnamed: 0": 363,
    "time": 1329177600,
    "open": 2.13,
    "high": 2.2633,
    "low": 2.0933,
    "close": 2.2633,
    "volume": 26682000.0
  },
  {
    "Unnamed: 0": 364,
    "time": 1329264000,
    "open": 2.2667,
    "high": 2.3953,
    "low": 2.1513,
    "close": 2.29,
    "volume": 40675500.0
  },
  {
    "Unnamed: 0": 365,
    "time": 1329350400,
    "open": 2.2667,
    "high": 2.3007,
    "low": 2.1693,
    "close": 2.3007,
    "volume": 32883000.0
  },
  {
    "Unnamed: 0": 366,
    "time": 1329436800,
    "open": 2.3253,
    "high": 2.334,
    "low": 2.2333,
    "close": 2.316,
    "volume": 20112000.0
  },
  {
    "Unnamed: 0": 367,
    "time": 1329782400,
    "open": 2.32,
    "high": 2.3433,
    "low": 2.254,
    "close": 2.3033,
    "volume": 16618500.0
  },
  {
    "Unnamed: 0": 368,
    "time": 1329868800,
    "open": 2.3,
    "high": 2.3147,
    "low": 2.1667,
    "close": 2.27,
    "volume": 23985000.0
  },
  {
    "Unnamed: 0": 369,
    "time": 1329955200,
    "open": 2.266,
    "high": 2.3313,
    "low": 2.2373,
    "close": 2.3013,
    "volume": 11665500.0
  },
  {
    "Unnamed: 0": 370,
    "time": 1330041600,
    "open": 2.2933,
    "high": 2.3013,
    "low": 2.218,
    "close": 2.2533,
    "volume": 14241000.0
  },
  {
    "Unnamed: 0": 371,
    "time": 1330300800,
    "open": 2.244,
    "high": 2.2667,
    "low": 2.2,
    "close": 2.2413,
    "volume": 8934000.0
  },
  {
    "Unnamed: 0": 372,
    "time": 1330387200,
    "open": 2.2427,
    "high": 2.296,
    "low": 2.2113,
    "close": 2.2607,
    "volume": 9070500.0
  },
  {
    "Unnamed: 0": 373,
    "time": 1330473600,
    "open": 2.254,
    "high": 2.2747,
    "low": 2.2087,
    "close": 2.2087,
    "volume": 7635000.0
  },
  {
    "Unnamed: 0": 374,
    "time": 1330560000,
    "open": 2.2373,
    "high": 2.3,
    "low": 2.22,
    "close": 2.294,
    "volume": 8875500.0
  },
  {
    "Unnamed: 0": 375,
    "time": 1330646400,
    "open": 2.2933,
    "high": 2.3,
    "low": 2.2473,
    "close": 2.2727,
    "volume": 7927500.0
  },
  {
    "Unnamed: 0": 376,
    "time": 1330905600,
    "open": 2.2733,
    "high": 2.2933,
    "low": 2.2307,
    "close": 2.2513,
    "volume": 6894000.0
  },
  {
    "Unnamed: 0": 377,
    "time": 1330992000,
    "open": 2.2267,
    "high": 2.2267,
    "low": 2.1747,
    "close": 2.1987,
    "volume": 7669500.0
  },
  {
    "Unnamed: 0": 378,
    "time": 1331078400,
    "open": 2.208,
    "high": 2.2213,
    "low": 2.194,
    "close": 2.208,
    "volume": 5398500.0
  },
  {
    "Unnamed: 0": 379,
    "time": 1331164800,
    "open": 2.2073,
    "high": 2.2327,
    "low": 2.2027,
    "close": 2.2047,
    "volume": 8953500.0
  },
  {
    "Unnamed: 0": 380,
    "time": 1331251200,
    "open": 2.2133,
    "high": 2.354,
    "low": 2.2133,
    "close": 2.3307,
    "volume": 22969500.0
  },
  {
    "Unnamed: 0": 381,
    "time": 1331510400,
    "open": 2.3127,
    "high": 2.4193,
    "low": 2.3067,
    "close": 2.4067,
    "volume": 28791000.0
  },
  {
    "Unnamed: 0": 382,
    "time": 1331596800,
    "open": 2.4007,
    "high": 2.4393,
    "low": 2.3667,
    "close": 2.3793,
    "volume": 14412000.0
  },
  {
    "Unnamed: 0": 383,
    "time": 1331683200,
    "open": 2.4,
    "high": 2.4007,
    "low": 2.32,
    "close": 2.3553,
    "volume": 12595500.0
  },
  {
    "Unnamed: 0": 384,
    "time": 1331769600,
    "open": 2.352,
    "high": 2.3653,
    "low": 2.3187,
    "close": 2.3387,
    "volume": 8461500.0
  },
  {
    "Unnamed: 0": 385,
    "time": 1331856000,
    "open": 2.3287,
    "high": 2.3927,
    "low": 2.322,
    "close": 2.3533,
    "volume": 10819500.0
  },
  {
    "Unnamed: 0": 386,
    "time": 1332115200,
    "open": 2.3507,
    "high": 2.3547,
    "low": 2.3027,
    "close": 2.332,
    "volume": 14856000.0
  },
  {
    "Unnamed: 0": 387,
    "time": 1332201600,
    "open": 2.332,
    "high": 2.3467,
    "low": 2.3047,
    "close": 2.3307,
    "volume": 8392500.0
  },
  {
    "Unnamed: 0": 388,
    "time": 1332288000,
    "open": 2.3293,
    "high": 2.354,
    "low": 2.3067,
    "close": 2.336,
    "volume": 8650500.0
  },
  {
    "Unnamed: 0": 389,
    "time": 1332374400,
    "open": 2.3467,
    "high": 2.3467,
    "low": 2.2867,
    "close": 2.3173,
    "volume": 7563000.0
  },
  {
    "Unnamed: 0": 390,
    "time": 1332460800,
    "open": 2.2833,
    "high": 2.3087,
    "low": 2.21,
    "close": 2.29,
    "volume": 16336500.0
  },
  {
    "Unnamed: 0": 391,
    "time": 1332720000,
    "open": 2.3333,
    "high": 2.5393,
    "low": 2.3333,
    "close": 2.4833,
    "volume": 46437000.0
  },
  {
    "Unnamed: 0": 392,
    "time": 1332806400,
    "open": 2.4833,
    "high": 2.6633,
    "low": 2.4687,
    "close": 2.588,
    "volume": 36403500.0
  },
  {
    "Unnamed: 0": 393,
    "time": 1332892800,
    "open": 2.5547,
    "high": 2.5627,
    "low": 2.474,
    "close": 2.506,
    "volume": 13975500.0
  },
  {
    "Unnamed: 0": 394,
    "time": 1332979200,
    "open": 2.4707,
    "high": 2.546,
    "low": 2.4667,
    "close": 2.4887,
    "volume": 10455000.0
  },
  {
    "Unnamed: 0": 395,
    "time": 1333065600,
    "open": 2.5013,
    "high": 2.5293,
    "low": 2.4453,
    "close": 2.48,
    "volume": 11152500.0
  },
  {
    "Unnamed: 0": 396,
    "time": 1333324800,
    "open": 2.4733,
    "high": 2.5313,
    "low": 2.4353,
    "close": 2.44,
    "volume": 13074000.0
  },
  {
    "Unnamed: 0": 397,
    "time": 1333411200,
    "open": 2.4433,
    "high": 2.5647,
    "low": 2.396,
    "close": 2.4,
    "volume": 16107000.0
  },
  {
    "Unnamed: 0": 398,
    "time": 1333497600,
    "open": 2.41,
    "high": 2.41,
    "low": 2.3127,
    "close": 2.33,
    "volume": 66337500.0
  },
  {
    "Unnamed: 0": 399,
    "time": 1333584000,
    "open": 2.3507,
    "high": 2.3627,
    "low": 2.2927,
    "close": 2.2927,
    "volume": 21292500.0
  },
  {
    "Unnamed: 0": 400,
    "time": 1333929600,
    "open": 2.2733,
    "high": 2.308,
    "low": 2.2,
    "close": 2.2,
    "volume": 24487500.0
  },
  {
    "Unnamed: 0": 401,
    "time": 1334016000,
    "open": 2.2127,
    "high": 2.2567,
    "low": 2.14,
    "close": 2.1653,
    "volume": 25423500.0
  },
  {
    "Unnamed: 0": 402,
    "time": 1334102400,
    "open": 2.1953,
    "high": 2.2193,
    "low": 2.134,
    "close": 2.2007,
    "volume": 16089000.0
  },
  {
    "Unnamed: 0": 403,
    "time": 1334188800,
    "open": 2.2333,
    "high": 2.2987,
    "low": 2.1947,
    "close": 2.2387,
    "volume": 14713500.0
  },
  {
    "Unnamed: 0": 404,
    "time": 1334275200,
    "open": 2.2267,
    "high": 2.2693,
    "low": 2.19,
    "close": 2.2533,
    "volume": 9622500.0
  },
  {
    "Unnamed: 0": 405,
    "time": 1334534400,
    "open": 2.2273,
    "high": 2.2467,
    "low": 2.1393,
    "close": 2.1633,
    "volume": 15481500.0
  },
  {
    "Unnamed: 0": 406,
    "time": 1334620800,
    "open": 2.15,
    "high": 2.2047,
    "low": 2.136,
    "close": 2.1493,
    "volume": 16413000.0
  },
  {
    "Unnamed: 0": 407,
    "time": 1334707200,
    "open": 2.1407,
    "high": 2.188,
    "low": 2.102,
    "close": 2.1773,
    "volume": 12088500.0
  },
  {
    "Unnamed: 0": 408,
    "time": 1334793600,
    "open": 2.1087,
    "high": 2.2287,
    "low": 2.1087,
    "close": 2.198,
    "volume": 11424000.0
  },
  {
    "Unnamed: 0": 409,
    "time": 1334880000,
    "open": 2.2433,
    "high": 2.2567,
    "low": 2.196,
    "close": 2.2107,
    "volume": 12180000.0
  },
  {
    "Unnamed: 0": 410,
    "time": 1335139200,
    "open": 2.2113,
    "high": 2.2113,
    "low": 2.114,
    "close": 2.1293,
    "volume": 13161000.0
  },
  {
    "Unnamed: 0": 411,
    "time": 1335225600,
    "open": 2.1493,
    "high": 2.1493,
    "low": 2.0667,
    "close": 2.1233,
    "volume": 9708000.0
  },
  {
    "Unnamed: 0": 412,
    "time": 1335312000,
    "open": 2.1267,
    "high": 2.1993,
    "low": 2.1267,
    "close": 2.194,
    "volume": 10542000.0
  },
  {
    "Unnamed: 0": 413,
    "time": 1335398400,
    "open": 2.194,
    "high": 2.2367,
    "low": 2.194,
    "close": 2.2367,
    "volume": 6229500.0
  },
  {
    "Unnamed: 0": 414,
    "time": 1335484800,
    "open": 2.3013,
    "high": 2.3013,
    "low": 2.194,
    "close": 2.2227,
    "volume": 8539500.0
  },
  {
    "Unnamed: 0": 415,
    "time": 1335744000,
    "open": 2.218,
    "high": 2.224,
    "low": 2.172,
    "close": 2.22,
    "volume": 6088500.0
  },
  {
    "Unnamed: 0": 416,
    "time": 1335830400,
    "open": 2.216,
    "high": 2.2807,
    "low": 2.2087,
    "close": 2.252,
    "volume": 9690000.0
  },
  {
    "Unnamed: 0": 417,
    "time": 1335916800,
    "open": 2.2233,
    "high": 2.2927,
    "low": 2.2233,
    "close": 2.2627,
    "volume": 7291500.0
  },
  {
    "Unnamed: 0": 418,
    "time": 1336003200,
    "open": 2.2747,
    "high": 2.2747,
    "low": 2.14,
    "close": 2.14,
    "volume": 12472500.0
  },
  {
    "Unnamed: 0": 419,
    "time": 1336089600,
    "open": 2.1573,
    "high": 2.164,
    "low": 2.0933,
    "close": 2.12,
    "volume": 18291000.0
  },
  {
    "Unnamed: 0": 420,
    "time": 1336348800,
    "open": 2.1233,
    "high": 2.172,
    "low": 2.1073,
    "close": 2.1647,
    "volume": 16948500.0
  },
  {
    "Unnamed: 0": 421,
    "time": 1336435200,
    "open": 2.1647,
    "high": 2.186,
    "low": 1.958,
    "close": 2.038,
    "volume": 45520500.0
  },
  {
    "Unnamed: 0": 422,
    "time": 1336521600,
    "open": 2.004,
    "high": 2.1933,
    "low": 1.9667,
    "close": 2.1173,
    "volume": 28653000.0
  },
  {
    "Unnamed: 0": 423,
    "time": 1336608000,
    "open": 2.12,
    "high": 2.312,
    "low": 2.1173,
    "close": 2.1973,
    "volume": 82389000.0
  },
  {
    "Unnamed: 0": 424,
    "time": 1336694400,
    "open": 2.1867,
    "high": 2.2293,
    "low": 2.144,
    "close": 2.18,
    "volume": 18039000.0
  },
  {
    "Unnamed: 0": 425,
    "time": 1336953600,
    "open": 2.1333,
    "high": 2.142,
    "low": 2.0007,
    "close": 2.0107,
    "volume": 20400000.0
  },
  {
    "Unnamed: 0": 426,
    "time": 1337040000,
    "open": 2.024,
    "high": 2.064,
    "low": 1.948,
    "close": 1.9827,
    "volume": 22992000.0
  },
  {
    "Unnamed: 0": 427,
    "time": 1337126400,
    "open": 1.9933,
    "high": 2.012,
    "low": 1.9253,
    "close": 1.9627,
    "volume": 18601500.0
  },
  {
    "Unnamed: 0": 428,
    "time": 1337212800,
    "open": 1.9613,
    "high": 1.986,
    "low": 1.8827,
    "close": 1.8987,
    "volume": 16810500.0
  },
  {
    "Unnamed: 0": 429,
    "time": 1337299200,
    "open": 1.8933,
    "high": 1.8973,
    "low": 1.7887,
    "close": 1.8487,
    "volume": 22939500.0
  },
  {
    "Unnamed: 0": 430,
    "time": 1337558400,
    "open": 1.856,
    "high": 1.9507,
    "low": 1.808,
    "close": 1.918,
    "volume": 21505500.0
  },
  {
    "Unnamed: 0": 431,
    "time": 1337644800,
    "open": 1.974,
    "high": 2.0893,
    "low": 1.966,
    "close": 2.0527,
    "volume": 35101500.0
  },
  {
    "Unnamed: 0": 432,
    "time": 1337731200,
    "open": 2.0527,
    "high": 2.07,
    "low": 1.9667,
    "close": 2.014,
    "volume": 18036000.0
  },
  {
    "Unnamed: 0": 433,
    "time": 1337817600,
    "open": 2.0833,
    "high": 2.0833,
    "low": 1.9793,
    "close": 2.0053,
    "volume": 15760500.0
  },
  {
    "Unnamed: 0": 434,
    "time": 1337904000,
    "open": 2.0267,
    "high": 2.0273,
    "low": 1.9467,
    "close": 1.9753,
    "volume": 11173500.0
  },
  {
    "Unnamed: 0": 435,
    "time": 1338249600,
    "open": 2.0007,
    "high": 2.1287,
    "low": 2.0007,
    "close": 2.1127,
    "volume": 23724000.0
  },
  {
    "Unnamed: 0": 436,
    "time": 1338336000,
    "open": 2.072,
    "high": 2.0947,
    "low": 2.016,
    "close": 2.0267,
    "volume": 19323000.0
  },
  {
    "Unnamed: 0": 437,
    "time": 1338422400,
    "open": 2.0493,
    "high": 2.05,
    "low": 1.9167,
    "close": 1.9913,
    "volume": 15906000.0
  },
  {
    "Unnamed: 0": 438,
    "time": 1338508800,
    "open": 1.94,
    "high": 1.9467,
    "low": 1.8507,
    "close": 1.886,
    "volume": 13029000.0
  },
  {
    "Unnamed: 0": 439,
    "time": 1338768000,
    "open": 1.8533,
    "high": 1.894,
    "low": 1.8073,
    "close": 1.8567,
    "volume": 15243000.0
  },
  {
    "Unnamed: 0": 440,
    "time": 1338854400,
    "open": 1.8607,
    "high": 1.8927,
    "low": 1.8373,
    "close": 1.8607,
    "volume": 9331500.0
  },
  {
    "Unnamed: 0": 441,
    "time": 1338940800,
    "open": 1.872,
    "high": 1.9887,
    "low": 1.872,
    "close": 1.9887,
    "volume": 13300500.0
  },
  {
    "Unnamed: 0": 442,
    "time": 1339027200,
    "open": 1.9993,
    "high": 2.0,
    "low": 1.9233,
    "close": 1.9293,
    "volume": 7242000.0
  },
  {
    "Unnamed: 0": 443,
    "time": 1339113600,
    "open": 1.9267,
    "high": 2.0127,
    "low": 1.8767,
    "close": 2.0053,
    "volume": 12514500.0
  },
  {
    "Unnamed: 0": 444,
    "time": 1339372800,
    "open": 2.0547,
    "high": 2.0667,
    "low": 1.9227,
    "close": 1.9227,
    "volume": 9043500.0
  },
  {
    "Unnamed: 0": 445,
    "time": 1339459200,
    "open": 1.9413,
    "high": 1.9893,
    "low": 1.9207,
    "close": 1.952,
    "volume": 8221500.0
  },
  {
    "Unnamed: 0": 446,
    "time": 1339545600,
    "open": 1.97,
    "high": 2.0427,
    "low": 1.9647,
    "close": 1.9847,
    "volume": 12510000.0
  },
  {
    "Unnamed: 0": 447,
    "time": 1339632000,
    "open": 2.014,
    "high": 2.0433,
    "low": 1.908,
    "close": 1.9593,
    "volume": 12885000.0
  },
  {
    "Unnamed: 0": 448,
    "time": 1339718400,
    "open": 1.9593,
    "high": 1.9967,
    "low": 1.9207,
    "close": 1.988,
    "volume": 8910000.0
  },
  {
    "Unnamed: 0": 449,
    "time": 1339977600,
    "open": 2.0167,
    "high": 2.1553,
    "low": 1.9667,
    "close": 2.004,
    "volume": 17913000.0
  },
  {
    "Unnamed: 0": 450,
    "time": 1340064000,
    "open": 2.12,
    "high": 2.1773,
    "low": 2.1,
    "close": 2.1507,
    "volume": 13380000.0
  },
  {
    "Unnamed: 0": 451,
    "time": 1340150400,
    "open": 2.1807,
    "high": 2.3,
    "low": 2.1807,
    "close": 2.252,
    "volume": 50334000.0
  },
  {
    "Unnamed: 0": 452,
    "time": 1340236800,
    "open": 2.24,
    "high": 2.2853,
    "low": 2.1227,
    "close": 2.1507,
    "volume": 25275000.0
  },
  {
    "Unnamed: 0": 453,
    "time": 1340323200,
    "open": 2.1733,
    "high": 2.2653,
    "low": 2.1527,
    "close": 2.252,
    "volume": 44323500.0
  },
  {
    "Unnamed: 0": 454,
    "time": 1340582400,
    "open": 2.2927,
    "high": 2.2927,
    "low": 2.1207,
    "close": 2.1267,
    "volume": 22111500.0
  },
  {
    "Unnamed: 0": 455,
    "time": 1340668800,
    "open": 2.138,
    "high": 2.1567,
    "low": 2.092,
    "close": 2.0933,
    "volume": 37164000.0
  },
  {
    "Unnamed: 0": 456,
    "time": 1340755200,
    "open": 2.1307,
    "high": 2.1633,
    "low": 2.1047,
    "close": 2.1307,
    "volume": 14725500.0
  },
  {
    "Unnamed: 0": 457,
    "time": 1340841600,
    "open": 2.1413,
    "high": 2.1413,
    "low": 2.0413,
    "close": 2.094,
    "volume": 13173000.0
  },
  {
    "Unnamed: 0": 458,
    "time": 1340928000,
    "open": 2.1213,
    "high": 2.262,
    "low": 2.0667,
    "close": 2.086,
    "volume": 15910500.0
  },
  {
    "Unnamed: 0": 459,
    "time": 1341187200,
    "open": 2.086,
    "high": 2.12,
    "low": 2.0127,
    "close": 2.0267,
    "volume": 19246500.0
  },
  {
    "Unnamed: 0": 460,
    "time": 1341273600,
    "open": 2.0333,
    "high": 2.0667,
    "low": 2.0267,
    "close": 2.0393,
    "volume": 13993500.0
  },
  {
    "Unnamed: 0": 461,
    "time": 1341446400,
    "open": 2.0733,
    "high": 2.1113,
    "low": 2.0467,
    "close": 2.0833,
    "volume": 18108000.0
  },
  {
    "Unnamed: 0": 462,
    "time": 1341532800,
    "open": 2.088,
    "high": 2.1153,
    "low": 2.0473,
    "close": 2.0473,
    "volume": 10950000.0
  },
  {
    "Unnamed: 0": 463,
    "time": 1341792000,
    "open": 2.0627,
    "high": 2.122,
    "low": 2.0447,
    "close": 2.0993,
    "volume": 13303500.0
  },
  {
    "Unnamed: 0": 464,
    "time": 1341878400,
    "open": 2.094,
    "high": 2.1653,
    "low": 2.0593,
    "close": 2.08,
    "volume": 10500000.0
  },
  {
    "Unnamed: 0": 465,
    "time": 1341964800,
    "open": 2.0907,
    "high": 2.112,
    "low": 2.0673,
    "close": 2.0887,
    "volume": 8515500.0
  },
  {
    "Unnamed: 0": 466,
    "time": 1342051200,
    "open": 2.086,
    "high": 2.2007,
    "low": 2.0533,
    "close": 2.18,
    "volume": 15897000.0
  },
  {
    "Unnamed: 0": 467,
    "time": 1342137600,
    "open": 2.1907,
    "high": 2.2933,
    "low": 2.18,
    "close": 2.2667,
    "volume": 19225500.0
  },
  {
    "Unnamed: 0": 468,
    "time": 1342396800,
    "open": 2.2667,
    "high": 2.4,
    "low": 2.26,
    "close": 2.3973,
    "volume": 25431000.0
  },
  {
    "Unnamed: 0": 469,
    "time": 1342483200,
    "open": 2.354,
    "high": 2.3827,
    "low": 2.1587,
    "close": 2.218,
    "volume": 37756500.0
  },
  {
    "Unnamed: 0": 470,
    "time": 1342569600,
    "open": 2.1967,
    "high": 2.2447,
    "low": 2.0553,
    "close": 2.1333,
    "volume": 42406500.0
  },
  {
    "Unnamed: 0": 471,
    "time": 1342656000,
    "open": 2.1333,
    "high": 2.21,
    "low": 2.1333,
    "close": 2.1433,
    "volume": 21282000.0
  },
  {
    "Unnamed: 0": 472,
    "time": 1342742400,
    "open": 2.1267,
    "high": 2.158,
    "low": 2.0833,
    "close": 2.1207,
    "volume": 23131500.0
  },
  {
    "Unnamed: 0": 473,
    "time": 1343001600,
    "open": 2.1227,
    "high": 2.1227,
    "low": 2.0413,
    "close": 2.1193,
    "volume": 20463000.0
  },
  {
    "Unnamed: 0": 474,
    "time": 1343088000,
    "open": 2.0467,
    "high": 2.0693,
    "low": 1.9747,
    "close": 2.0073,
    "volume": 21778500.0
  },
  {
    "Unnamed: 0": 475,
    "time": 1343174400,
    "open": 1.9733,
    "high": 2.0167,
    "low": 1.8353,
    "close": 1.8827,
    "volume": 37428000.0
  },
  {
    "Unnamed: 0": 476,
    "time": 1343260800,
    "open": 1.932,
    "high": 2.004,
    "low": 1.8427,
    "close": 1.8833,
    "volume": 33084000.0
  },
  {
    "Unnamed: 0": 477,
    "time": 1343347200,
    "open": 1.9107,
    "high": 1.9773,
    "low": 1.8733,
    "close": 1.9673,
    "volume": 24735000.0
  },
  {
    "Unnamed: 0": 478,
    "time": 1343606400,
    "open": 1.9713,
    "high": 2.0167,
    "low": 1.814,
    "close": 1.8367,
    "volume": 29761500.0
  },
  {
    "Unnamed: 0": 479,
    "time": 1343692800,
    "open": 1.8367,
    "high": 1.8647,
    "low": 1.8233,
    "close": 1.8527,
    "volume": 20505000.0
  },
  {
    "Unnamed: 0": 480,
    "time": 1343779200,
    "open": 1.8567,
    "high": 1.866,
    "low": 1.7327,
    "close": 1.7327,
    "volume": 21585000.0
  },
  {
    "Unnamed: 0": 481,
    "time": 1343865600,
    "open": 1.7507,
    "high": 1.79,
    "low": 1.7013,
    "close": 1.74,
    "volume": 19086000.0
  },
  {
    "Unnamed: 0": 482,
    "time": 1343952000,
    "open": 1.7553,
    "high": 1.8367,
    "low": 1.74,
    "close": 1.74,
    "volume": 17092500.0
  },
  {
    "Unnamed: 0": 483,
    "time": 1344211200,
    "open": 1.8227,
    "high": 1.9133,
    "low": 1.8227,
    "close": 1.8873,
    "volume": 17017500.0
  },
  {
    "Unnamed: 0": 484,
    "time": 1344297600,
    "open": 1.8893,
    "high": 2.06,
    "low": 1.8847,
    "close": 2.0167,
    "volume": 28341000.0
  },
  {
    "Unnamed: 0": 485,
    "time": 1344384000,
    "open": 2.0493,
    "high": 2.0527,
    "low": 1.906,
    "close": 1.9393,
    "volume": 17298000.0
  },
  {
    "Unnamed: 0": 486,
    "time": 1344470400,
    "open": 1.9633,
    "high": 2.0,
    "low": 1.9393,
    "close": 1.9533,
    "volume": 9636000.0
  },
  {
    "Unnamed: 0": 487,
    "time": 1344556800,
    "open": 1.9533,
    "high": 1.996,
    "low": 1.9533,
    "close": 1.996,
    "volume": 10066500.0
  },
  {
    "Unnamed: 0": 488,
    "time": 1344816000,
    "open": 1.9827,
    "high": 2.0867,
    "low": 1.94,
    "close": 2.0633,
    "volume": 12691500.0
  },
  {
    "Unnamed: 0": 489,
    "time": 1344902400,
    "open": 2.0667,
    "high": 2.078,
    "low": 1.9467,
    "close": 1.9467,
    "volume": 11076000.0
  },
  {
    "Unnamed: 0": 490,
    "time": 1344988800,
    "open": 1.9593,
    "high": 1.98,
    "low": 1.9207,
    "close": 1.96,
    "volume": 7506000.0
  },
  {
    "Unnamed: 0": 491,
    "time": 1345075200,
    "open": 1.9687,
    "high": 2.026,
    "low": 1.96,
    "close": 1.96,
    "volume": 8028000.0
  },
  {
    "Unnamed: 0": 492,
    "time": 1345161600,
    "open": 2.0,
    "high": 2.0473,
    "low": 1.9987,
    "close": 2.0,
    "volume": 7033500.0
  },
  {
    "Unnamed: 0": 493,
    "time": 1345420800,
    "open": 2.01,
    "high": 2.026,
    "low": 1.94,
    "close": 1.982,
    "volume": 13743000.0
  },
  {
    "Unnamed: 0": 494,
    "time": 1345507200,
    "open": 1.9727,
    "high": 2.0,
    "low": 1.9333,
    "close": 1.9407,
    "volume": 10840500.0
  },
  {
    "Unnamed: 0": 495,
    "time": 1345593600,
    "open": 1.9453,
    "high": 2.0167,
    "low": 1.93,
    "close": 2.0167,
    "volume": 10396500.0
  },
  {
    "Unnamed: 0": 496,
    "time": 1345680000,
    "open": 2.0,
    "high": 2.0567,
    "low": 1.9767,
    "close": 2.034,
    "volume": 21502500.0
  },
  {
    "Unnamed: 0": 497,
    "time": 1345766400,
    "open": 2.018,
    "high": 2.0487,
    "low": 1.9607,
    "close": 1.9727,
    "volume": 20377500.0
  },
  {
    "Unnamed: 0": 498,
    "time": 1346025600,
    "open": 1.972,
    "high": 1.98,
    "low": 1.878,
    "close": 1.8833,
    "volume": 18559500.0
  },
  {
    "Unnamed: 0": 499,
    "time": 1346112000,
    "open": 1.8947,
    "high": 1.9587,
    "low": 1.8667,
    "close": 1.9127,
    "volume": 20662500.0
  },
  {
    "Unnamed: 0": 500,
    "time": 1346198400,
    "open": 1.918,
    "high": 1.92,
    "low": 1.868,
    "close": 1.894,
    "volume": 12213000.0
  },
  {
    "Unnamed: 0": 501,
    "time": 1346284800,
    "open": 1.8673,
    "high": 1.916,
    "low": 1.8673,
    "close": 1.894,
    "volume": 9609000.0
  },
  {
    "Unnamed: 0": 502,
    "time": 1346371200,
    "open": 1.8993,
    "high": 1.9227,
    "low": 1.88,
    "close": 1.9007,
    "volume": 7690500.0
  },
  {
    "Unnamed: 0": 503,
    "time": 1346716800,
    "open": 1.9013,
    "high": 1.9327,
    "low": 1.86,
    "close": 1.876,
    "volume": 10840500.0
  },
  {
    "Unnamed: 0": 504,
    "time": 1346803200,
    "open": 1.8767,
    "high": 1.9,
    "low": 1.854,
    "close": 1.8627,
    "volume": 9276000.0
  },
  {
    "Unnamed: 0": 505,
    "time": 1346889600,
    "open": 1.8673,
    "high": 1.9267,
    "low": 1.86,
    "close": 1.9033,
    "volume": 12036000.0
  },
  {
    "Unnamed: 0": 506,
    "time": 1346976000,
    "open": 1.8933,
    "high": 1.9713,
    "low": 1.8933,
    "close": 1.9567,
    "volume": 13315500.0
  },
  {
    "Unnamed: 0": 507,
    "time": 1347235200,
    "open": 1.9467,
    "high": 1.9667,
    "low": 1.82,
    "close": 1.8233,
    "volume": 20403000.0
  },
  {
    "Unnamed: 0": 508,
    "time": 1347321600,
    "open": 1.874,
    "high": 1.8773,
    "low": 1.8267,
    "close": 1.85,
    "volume": 12136500.0
  },
  {
    "Unnamed: 0": 509,
    "time": 1347408000,
    "open": 1.86,
    "high": 1.9053,
    "low": 1.8533,
    "close": 1.9053,
    "volume": 16017000.0
  },
  {
    "Unnamed: 0": 510,
    "time": 1347494400,
    "open": 1.9053,
    "high": 1.9773,
    "low": 1.88,
    "close": 1.9493,
    "volume": 20878500.0
  },
  {
    "Unnamed: 0": 511,
    "time": 1347580800,
    "open": 1.9667,
    "high": 2.0433,
    "low": 1.9653,
    "close": 2.024,
    "volume": 21982500.0
  },
  {
    "Unnamed: 0": 512,
    "time": 1347840000,
    "open": 2.0453,
    "high": 2.2013,
    "low": 2.0453,
    "close": 2.1667,
    "volume": 46476000.0
  },
  {
    "Unnamed: 0": 513,
    "time": 1347926400,
    "open": 2.134,
    "high": 2.1693,
    "low": 2.0453,
    "close": 2.0893,
    "volume": 26220000.0
  },
  {
    "Unnamed: 0": 514,
    "time": 1348012800,
    "open": 2.09,
    "high": 2.116,
    "low": 2.0627,
    "close": 2.07,
    "volume": 15385500.0
  },
  {
    "Unnamed: 0": 515,
    "time": 1348099200,
    "open": 2.08,
    "high": 2.1,
    "low": 2.0453,
    "close": 2.0613,
    "volume": 10585500.0
  },
  {
    "Unnamed: 0": 516,
    "time": 1348185600,
    "open": 2.06,
    "high": 2.1,
    "low": 1.9693,
    "close": 2.0013,
    "volume": 24996000.0
  },
  {
    "Unnamed: 0": 517,
    "time": 1348444800,
    "open": 2.0,
    "high": 2.0687,
    "low": 1.96,
    "close": 2.044,
    "volume": 18555000.0
  },
  {
    "Unnamed: 0": 518,
    "time": 1348531200,
    "open": 2.0533,
    "high": 2.0533,
    "low": 1.7133,
    "close": 1.8553,
    "volume": 78354000.0
  },
  {
    "Unnamed: 0": 519,
    "time": 1348617600,
    "open": 1.85,
    "high": 1.8933,
    "low": 1.8,
    "close": 1.8427,
    "volume": 22567500.0
  },
  {
    "Unnamed: 0": 520,
    "time": 1348704000,
    "open": 1.85,
    "high": 1.9027,
    "low": 1.84,
    "close": 1.8893,
    "volume": 26001000.0
  },
  {
    "Unnamed: 0": 521,
    "time": 1348790400,
    "open": 1.92,
    "high": 1.9927,
    "low": 1.8667,
    "close": 1.956,
    "volume": 64419000.0
  },
  {
    "Unnamed: 0": 522,
    "time": 1349049600,
    "open": 1.9533,
    "high": 1.9927,
    "low": 1.9333,
    "close": 1.944,
    "volume": 12910500.0
  },
  {
    "Unnamed: 0": 523,
    "time": 1349136000,
    "open": 1.95,
    "high": 1.9927,
    "low": 1.9333,
    "close": 1.9867,
    "volume": 10389000.0
  },
  {
    "Unnamed: 0": 524,
    "time": 1349222400,
    "open": 1.9767,
    "high": 2.0,
    "low": 1.9493,
    "close": 2.0,
    "volume": 12870000.0
  },
  {
    "Unnamed: 0": 525,
    "time": 1349308800,
    "open": 1.9793,
    "high": 2.0133,
    "low": 1.91,
    "close": 1.9567,
    "volume": 18454500.0
  },
  {
    "Unnamed: 0": 526,
    "time": 1349395200,
    "open": 1.9733,
    "high": 1.9873,
    "low": 1.9067,
    "close": 1.9253,
    "volume": 12109500.0
  },
  {
    "Unnamed: 0": 527,
    "time": 1349654400,
    "open": 1.9267,
    "high": 1.96,
    "low": 1.9073,
    "close": 1.9467,
    "volume": 13128000.0
  },
  {
    "Unnamed: 0": 528,
    "time": 1349740800,
    "open": 1.9413,
    "high": 1.9413,
    "low": 1.8833,
    "close": 1.91,
    "volume": 17464500.0
  },
  {
    "Unnamed: 0": 529,
    "time": 1349827200,
    "open": 1.9,
    "high": 1.9333,
    "low": 1.8673,
    "close": 1.9133,
    "volume": 7413000.0
  },
  {
    "Unnamed: 0": 530,
    "time": 1349913600,
    "open": 1.906,
    "high": 1.932,
    "low": 1.8833,
    "close": 1.888,
    "volume": 6646500.0
  },
  {
    "Unnamed: 0": 531,
    "time": 1350000000,
    "open": 1.8953,
    "high": 1.9153,
    "low": 1.8333,
    "close": 1.8433,
    "volume": 13588500.0
  },
  {
    "Unnamed: 0": 532,
    "time": 1350259200,
    "open": 1.8473,
    "high": 1.87,
    "low": 1.7907,
    "close": 1.8067,
    "volume": 20388000.0
  },
  {
    "Unnamed: 0": 533,
    "time": 1350345600,
    "open": 1.8447,
    "high": 1.8727,
    "low": 1.8227,
    "close": 1.8707,
    "volume": 7063500.0
  },
  {
    "Unnamed: 0": 534,
    "time": 1350432000,
    "open": 1.8833,
    "high": 1.9227,
    "low": 1.8533,
    "close": 1.9213,
    "volume": 9720000.0
  },
  {
    "Unnamed: 0": 535,
    "time": 1350518400,
    "open": 1.9327,
    "high": 1.9327,
    "low": 1.852,
    "close": 1.8667,
    "volume": 9792000.0
  },
  {
    "Unnamed: 0": 536,
    "time": 1350604800,
    "open": 1.8527,
    "high": 1.88,
    "low": 1.82,
    "close": 1.8493,
    "volume": 10015500.0
  },
  {
    "Unnamed: 0": 537,
    "time": 1350864000,
    "open": 1.8493,
    "high": 1.8667,
    "low": 1.824,
    "close": 1.866,
    "volume": 5101500.0
  },
  {
    "Unnamed: 0": 538,
    "time": 1350950400,
    "open": 1.8267,
    "high": 1.904,
    "low": 1.8247,
    "close": 1.8833,
    "volume": 8620500.0
  },
  {
    "Unnamed: 0": 539,
    "time": 1351036800,
    "open": 1.9053,
    "high": 1.9053,
    "low": 1.812,
    "close": 1.82,
    "volume": 12669000.0
  },
  {
    "Unnamed: 0": 540,
    "time": 1351123200,
    "open": 1.8573,
    "high": 1.8573,
    "low": 1.83,
    "close": 1.8347,
    "volume": 8308500.0
  },
  {
    "Unnamed: 0": 541,
    "time": 1351209600,
    "open": 1.8333,
    "high": 1.8533,
    "low": 1.8013,
    "close": 1.8253,
    "volume": 6726000.0
  },
  {
    "Unnamed: 0": 542,
    "time": 1351641600,
    "open": 1.8333,
    "high": 1.89,
    "low": 1.8247,
    "close": 1.8753,
    "volume": 11193000.0
  },
  {
    "Unnamed: 0": 543,
    "time": 1351728000,
    "open": 1.8833,
    "high": 1.966,
    "low": 1.88,
    "close": 1.9527,
    "volume": 14761500.0
  },
  {
    "Unnamed: 0": 544,
    "time": 1351814400,
    "open": 1.9513,
    "high": 1.97,
    "low": 1.9033,
    "close": 1.9133,
    "volume": 14913000.0
  },
  {
    "Unnamed: 0": 545,
    "time": 1352073600,
    "open": 1.964,
    "high": 2.11,
    "low": 1.9553,
    "close": 2.1,
    "volume": 29164500.0
  },
  {
    "Unnamed: 0": 546,
    "time": 1352160000,
    "open": 2.1033,
    "high": 2.1033,
    "low": 1.9967,
    "close": 2.0813,
    "volume": 34033500.0
  },
  {
    "Unnamed: 0": 547,
    "time": 1352246400,
    "open": 2.09,
    "high": 2.1367,
    "low": 2.054,
    "close": 2.1033,
    "volume": 25089000.0
  },
  {
    "Unnamed: 0": 548,
    "time": 1352332800,
    "open": 2.0947,
    "high": 2.1253,
    "low": 2.0627,
    "close": 2.0873,
    "volume": 18096000.0
  },
  {
    "Unnamed: 0": 549,
    "time": 1352419200,
    "open": 2.068,
    "high": 2.0807,
    "low": 1.99,
    "close": 2.02,
    "volume": 12726000.0
  },
  {
    "Unnamed: 0": 550,
    "time": 1352678400,
    "open": 2.0193,
    "high": 2.1547,
    "low": 2.0107,
    "close": 2.15,
    "volume": 8142000.0
  },
  {
    "Unnamed: 0": 551,
    "time": 1352764800,
    "open": 2.0987,
    "high": 2.1333,
    "low": 2.048,
    "close": 2.1107,
    "volume": 14413500.0
  },
  {
    "Unnamed: 0": 552,
    "time": 1352851200,
    "open": 2.1307,
    "high": 2.1413,
    "low": 2.08,
    "close": 2.1,
    "volume": 12508500.0
  },
  {
    "Unnamed: 0": 553,
    "time": 1352937600,
    "open": 2.1133,
    "high": 2.1133,
    "low": 2.0333,
    "close": 2.06,
    "volume": 13594500.0
  },
  {
    "Unnamed: 0": 554,
    "time": 1353024000,
    "open": 2.06,
    "high": 2.156,
    "low": 2.0393,
    "close": 2.156,
    "volume": 12493500.0
  },
  {
    "Unnamed: 0": 555,
    "time": 1353283200,
    "open": 2.1333,
    "high": 2.2167,
    "low": 2.118,
    "close": 2.2,
    "volume": 19404000.0
  },
  {
    "Unnamed: 0": 556,
    "time": 1353369600,
    "open": 2.2,
    "high": 2.2073,
    "low": 2.1273,
    "close": 2.2073,
    "volume": 13012500.0
  },
  {
    "Unnamed: 0": 557,
    "time": 1353456000,
    "open": 2.1833,
    "high": 2.2313,
    "low": 2.1527,
    "close": 2.1613,
    "volume": 12994500.0
  },
  {
    "Unnamed: 0": 558,
    "time": 1353628800,
    "open": 2.1733,
    "high": 2.1887,
    "low": 2.1133,
    "close": 2.1413,
    "volume": 6234000.0
  },
  {
    "Unnamed: 0": 559,
    "time": 1353888000,
    "open": 2.1433,
    "high": 2.156,
    "low": 2.108,
    "close": 2.156,
    "volume": 6823500.0
  },
  {
    "Unnamed: 0": 560,
    "time": 1353974400,
    "open": 2.1553,
    "high": 2.1773,
    "low": 2.1013,
    "close": 2.1433,
    "volume": 10090500.0
  },
  {
    "Unnamed: 0": 561,
    "time": 1354060800,
    "open": 2.1533,
    "high": 2.286,
    "low": 2.1273,
    "close": 2.26,
    "volume": 22344000.0
  },
  {
    "Unnamed: 0": 562,
    "time": 1354147200,
    "open": 2.2433,
    "high": 2.2667,
    "low": 2.1913,
    "close": 2.234,
    "volume": 15483000.0
  },
  {
    "Unnamed: 0": 563,
    "time": 1354233600,
    "open": 2.24,
    "high": 2.2853,
    "low": 2.2007,
    "close": 2.2533,
    "volume": 20268000.0
  },
  {
    "Unnamed: 0": 564,
    "time": 1354492800,
    "open": 2.2667,
    "high": 2.3333,
    "low": 2.2333,
    "close": 2.316,
    "volume": 26139000.0
  },
  {
    "Unnamed: 0": 565,
    "time": 1354579200,
    "open": 2.3593,
    "high": 2.36,
    "low": 2.2367,
    "close": 2.2633,
    "volume": 18213000.0
  },
  {
    "Unnamed: 0": 566,
    "time": 1354665600,
    "open": 2.2567,
    "high": 2.2793,
    "low": 2.2387,
    "close": 2.2473,
    "volume": 7434000.0
  },
  {
    "Unnamed: 0": 567,
    "time": 1354752000,
    "open": 2.2667,
    "high": 2.32,
    "low": 2.2333,
    "close": 2.2933,
    "volume": 9687000.0
  },
  {
    "Unnamed: 0": 568,
    "time": 1354838400,
    "open": 2.2667,
    "high": 2.2993,
    "low": 2.2567,
    "close": 2.28,
    "volume": 9814500.0
  },
  {
    "Unnamed: 0": 569,
    "time": 1355097600,
    "open": 2.274,
    "high": 2.32,
    "low": 2.274,
    "close": 2.3047,
    "volume": 13413000.0
  },
  {
    "Unnamed: 0": 570,
    "time": 1355184000,
    "open": 2.3067,
    "high": 2.37,
    "low": 2.2973,
    "close": 2.3667,
    "volume": 22396500.0
  },
  {
    "Unnamed: 0": 571,
    "time": 1355270400,
    "open": 2.3427,
    "high": 2.3953,
    "low": 2.33,
    "close": 2.35,
    "volume": 29326500.0
  },
  {
    "Unnamed: 0": 572,
    "time": 1355356800,
    "open": 2.3487,
    "high": 2.3553,
    "low": 2.1833,
    "close": 2.25,
    "volume": 31737000.0
  },
  {
    "Unnamed: 0": 573,
    "time": 1355443200,
    "open": 2.252,
    "high": 2.2933,
    "low": 2.2393,
    "close": 2.2553,
    "volume": 14131500.0
  },
  {
    "Unnamed: 0": 574,
    "time": 1355702400,
    "open": 2.2667,
    "high": 2.3,
    "low": 2.25,
    "close": 2.2933,
    "volume": 12079500.0
  },
  {
    "Unnamed: 0": 575,
    "time": 1355788800,
    "open": 2.294,
    "high": 2.338,
    "low": 2.284,
    "close": 2.306,
    "volume": 23095500.0
  },
  {
    "Unnamed: 0": 576,
    "time": 1355875200,
    "open": 2.3267,
    "high": 2.3507,
    "low": 2.3013,
    "close": 2.3073,
    "volume": 18744000.0
  },
  {
    "Unnamed: 0": 577,
    "time": 1355961600,
    "open": 2.32,
    "high": 2.3207,
    "low": 2.27,
    "close": 2.2953,
    "volume": 13641000.0
  },
  {
    "Unnamed: 0": 578,
    "time": 1356048000,
    "open": 2.3,
    "high": 2.3,
    "low": 2.2387,
    "close": 2.2667,
    "volume": 21853500.0
  },
  {
    "Unnamed: 0": 579,
    "time": 1356307200,
    "open": 2.2,
    "high": 2.29,
    "low": 2.2,
    "close": 2.2853,
    "volume": 5562000.0
  },
  {
    "Unnamed: 0": 580,
    "time": 1356480000,
    "open": 2.264,
    "high": 2.3,
    "low": 2.2333,
    "close": 2.2333,
    "volume": 8796000.0
  },
  {
    "Unnamed: 0": 581,
    "time": 1356566400,
    "open": 2.234,
    "high": 2.2607,
    "low": 2.2,
    "close": 2.246,
    "volume": 8053500.0
  },
  {
    "Unnamed: 0": 582,
    "time": 1356652800,
    "open": 2.2413,
    "high": 2.2433,
    "low": 2.2,
    "close": 2.2,
    "volume": 6033000.0
  },
  {
    "Unnamed: 0": 583,
    "time": 1356912000,
    "open": 2.2027,
    "high": 2.2647,
    "low": 2.2,
    "close": 2.2567,
    "volume": 8590500.0
  },
  {
    "Unnamed: 0": 584,
    "time": 1357084800,
    "open": 2.3253,
    "high": 2.3633,
    "low": 2.3067,
    "close": 2.3567,
    "volume": 16518000.0
  },
  {
    "Unnamed: 0": 585,
    "time": 1357171200,
    "open": 2.3453,
    "high": 2.3633,
    "low": 2.3127,
    "close": 2.3127,
    "volume": 10825500.0
  },
  {
    "Unnamed: 0": 586,
    "time": 1363219200,
    "open": 2.5673,
    "high": 2.6,
    "low": 2.4027,
    "close": 2.4327,
    "volume": 29146500.0
  },
  {
    "Unnamed: 0": 587,
    "time": 1363305600,
    "open": 2.4333,
    "high": 2.4433,
    "low": 2.3473,
    "close": 2.3607,
    "volume": 42304500.0
  },
  {
    "Unnamed: 0": 588,
    "time": 1363564800,
    "open": 2.36,
    "high": 2.404,
    "low": 2.322,
    "close": 2.3467,
    "volume": 17931000.0
  },
  {
    "Unnamed: 0": 589,
    "time": 1363651200,
    "open": 2.366,
    "high": 2.3993,
    "low": 2.3293,
    "close": 2.3313,
    "volume": 15828000.0
  },
  {
    "Unnamed: 0": 590,
    "time": 1363737600,
    "open": 2.3507,
    "high": 2.4167,
    "low": 2.344,
    "close": 2.4147,
    "volume": 16198500.0
  },
  {
    "Unnamed: 0": 591,
    "time": 1363824000,
    "open": 2.4047,
    "high": 2.4707,
    "low": 2.3827,
    "close": 2.4007,
    "volume": 15042000.0
  },
  {
    "Unnamed: 0": 592,
    "time": 1363910400,
    "open": 2.4133,
    "high": 2.4533,
    "low": 2.4013,
    "close": 2.4413,
    "volume": 6421500.0
  },
  {
    "Unnamed: 0": 593,
    "time": 1364169600,
    "open": 2.4467,
    "high": 2.568,
    "low": 2.4467,
    "close": 2.5313,
    "volume": 34368000.0
  },
  {
    "Unnamed: 0": 594,
    "time": 1364256000,
    "open": 2.5067,
    "high": 2.548,
    "low": 2.5067,
    "close": 2.524,
    "volume": 22050000.0
  },
  {
    "Unnamed: 0": 595,
    "time": 1364342400,
    "open": 2.5133,
    "high": 2.5587,
    "low": 2.4873,
    "close": 2.5467,
    "volume": 18799500.0
  },
  {
    "Unnamed: 0": 596,
    "time": 1364428800,
    "open": 2.534,
    "high": 2.5707,
    "low": 2.5167,
    "close": 2.526,
    "volume": 11656500.0
  },
  {
    "Unnamed: 0": 597,
    "time": 1364774400,
    "open": 2.6067,
    "high": 3.112,
    "low": 2.6067,
    "close": 2.9667,
    "volume": 201547500.0
  },
  {
    "Unnamed: 0": 598,
    "time": 1364860800,
    "open": 2.94,
    "high": 3.046,
    "low": 2.846,
    "close": 2.8733,
    "volume": 94021500.0
  },
  {
    "Unnamed: 0": 599,
    "time": 1364947200,
    "open": 2.88,
    "high": 2.9467,
    "low": 2.6807,
    "close": 2.7253,
    "volume": 82765500.0
  },
  {
    "Unnamed: 0": 600,
    "time": 1365033600,
    "open": 2.7633,
    "high": 2.8167,
    "low": 2.7207,
    "close": 2.8,
    "volume": 32724000.0
  },
  {
    "Unnamed: 0": 601,
    "time": 1365120000,
    "open": 2.8,
    "high": 2.816,
    "low": 2.7,
    "close": 2.758,
    "volume": 20602500.0
  },
  {
    "Unnamed: 0": 602,
    "time": 1365379200,
    "open": 2.77,
    "high": 2.8367,
    "low": 2.7673,
    "close": 2.7887,
    "volume": 23578500.0
  },
  {
    "Unnamed: 0": 603,
    "time": 1365465600,
    "open": 2.7927,
    "high": 2.7927,
    "low": 2.6887,
    "close": 2.6933,
    "volume": 22929000.0
  },
  {
    "Unnamed: 0": 604,
    "time": 1365552000,
    "open": 2.714,
    "high": 2.8007,
    "low": 2.7013,
    "close": 2.7907,
    "volume": 29934000.0
  },
  {
    "Unnamed: 0": 605,
    "time": 1365638400,
    "open": 2.8093,
    "high": 2.97,
    "low": 2.7833,
    "close": 2.8667,
    "volume": 50419500.0
  },
  {
    "Unnamed: 0": 606,
    "time": 1365724800,
    "open": 2.906,
    "high": 3.0093,
    "low": 2.8673,
    "close": 2.9167,
    "volume": 43282500.0
  },
  {
    "Unnamed: 0": 607,
    "time": 1365984000,
    "open": 2.8673,
    "high": 2.9213,
    "low": 2.834,
    "close": 2.92,
    "volume": 23191500.0
  },
  {
    "Unnamed: 0": 608,
    "time": 1366070400,
    "open": 2.942,
    "high": 3.076,
    "low": 2.9273,
    "close": 3.032,
    "volume": 41016000.0
  },
  {
    "Unnamed: 0": 609,
    "time": 1366156800,
    "open": 3.0267,
    "high": 3.0633,
    "low": 2.9693,
    "close": 3.03,
    "volume": 29680500.0
  },
  {
    "Unnamed: 0": 610,
    "time": 1366243200,
    "open": 3.0653,
    "high": 3.1733,
    "low": 3.026,
    "close": 3.1627,
    "volume": 45765000.0
  },
  {
    "Unnamed: 0": 611,
    "time": 1366329600,
    "open": 3.1627,
    "high": 3.3253,
    "low": 3.138,
    "close": 3.1633,
    "volume": 43929000.0
  },
  {
    "Unnamed: 0": 612,
    "time": 1366588800,
    "open": 3.2133,
    "high": 3.3467,
    "low": 3.1667,
    "close": 3.346,
    "volume": 56449500.0
  },
  {
    "Unnamed: 0": 613,
    "time": 1366675200,
    "open": 3.346,
    "high": 3.528,
    "low": 3.346,
    "close": 3.3967,
    "volume": 53149500.0
  },
  {
    "Unnamed: 0": 614,
    "time": 1366761600,
    "open": 3.446,
    "high": 3.446,
    "low": 3.2653,
    "close": 3.38,
    "volume": 36709500.0
  },
  {
    "Unnamed: 0": 615,
    "time": 1366848000,
    "open": 3.4,
    "high": 3.4933,
    "low": 3.3653,
    "close": 3.48,
    "volume": 40113000.0
  },
  {
    "Unnamed: 0": 616,
    "time": 1366934400,
    "open": 3.5,
    "high": 3.5827,
    "low": 3.3747,
    "close": 3.3873,
    "volume": 52822500.0
  },
  {
    "Unnamed: 0": 617,
    "time": 1367193600,
    "open": 3.4,
    "high": 3.6667,
    "low": 3.3933,
    "close": 3.6653,
    "volume": 52944000.0
  },
  {
    "Unnamed: 0": 618,
    "time": 1367280000,
    "open": 3.6667,
    "high": 3.8787,
    "low": 3.5767,
    "close": 3.634,
    "volume": 79696500.0
  },
  {
    "Unnamed: 0": 619,
    "time": 1367366400,
    "open": 3.6447,
    "high": 3.7327,
    "low": 3.5333,
    "close": 3.596,
    "volume": 37645500.0
  },
  {
    "Unnamed: 0": 620,
    "time": 1367452800,
    "open": 3.5933,
    "high": 3.6847,
    "low": 3.5333,
    "close": 3.64,
    "volume": 44152500.0
  },
  {
    "Unnamed: 0": 621,
    "time": 1367539200,
    "open": 3.6833,
    "high": 3.7647,
    "low": 3.6233,
    "close": 3.6387,
    "volume": 49215000.0
  },
  {
    "Unnamed: 0": 622,
    "time": 1367798400,
    "open": 3.6727,
    "high": 4.0273,
    "low": 3.6727,
    "close": 4.0127,
    "volume": 63787500.0
  },
  {
    "Unnamed: 0": 623,
    "time": 1367884800,
    "open": 4.0,
    "high": 4.1893,
    "low": 3.6747,
    "close": 3.7707,
    "volume": 145771500.0
  },
  {
    "Unnamed: 0": 624,
    "time": 1367971200,
    "open": 3.7067,
    "high": 4.866,
    "low": 3.7,
    "close": 4.6,
    "volume": 97968000.0
  },
  {
    "Unnamed: 0": 625,
    "time": 1368057600,
    "open": 4.54,
    "high": 5.0513,
    "low": 4.246,
    "close": 4.59,
    "volume": 416440500.0
  },
  {
    "Unnamed: 0": 626,
    "time": 1368144000,
    "open": 4.6267,
    "high": 5.4,
    "low": 4.5447,
    "close": 5.1267,
    "volume": 362424000.0
  },
  {
    "Unnamed: 0": 627,
    "time": 1368403200,
    "open": 5.104,
    "high": 6.0133,
    "low": 5.0333,
    "close": 6.0007,
    "volume": 324441000.0
  },
  {
    "Unnamed: 0": 628,
    "time": 1368489600,
    "open": 6.0773,
    "high": 6.4747,
    "low": 5.41,
    "close": 5.4667,
    "volume": 540166500.0
  },
  {
    "Unnamed: 0": 629,
    "time": 1368576000,
    "open": 5.4673,
    "high": 6.2253,
    "low": 5.154,
    "close": 6.1333,
    "volume": 245694000.0
  },
  {
    "Unnamed: 0": 630,
    "time": 1368662400,
    "open": 6.1367,
    "high": 6.4267,
    "low": 5.9107,
    "close": 6.14,
    "volume": 314040000.0
  },
  {
    "Unnamed: 0": 631,
    "time": 1368748800,
    "open": 6.2493,
    "high": 6.3333,
    "low": 5.8333,
    "close": 6.0833,
    "volume": 275742000.0
  },
  {
    "Unnamed: 0": 632,
    "time": 1369008000,
    "open": 6.0933,
    "high": 6.1967,
    "low": 5.9087,
    "close": 5.9533,
    "volume": 116409000.0
  },
  {
    "Unnamed: 0": 633,
    "time": 1369094400,
    "open": 5.954,
    "high": 6.0533,
    "low": 5.6853,
    "close": 5.838,
    "volume": 129556500.0
  },
  {
    "Unnamed: 0": 634,
    "time": 1369180800,
    "open": 5.814,
    "high": 6.064,
    "low": 5.7,
    "close": 5.8187,
    "volume": 124705500.0
  },
  {
    "Unnamed: 0": 635,
    "time": 1369267200,
    "open": 5.7673,
    "high": 6.212,
    "low": 5.5367,
    "close": 6.2,
    "volume": 173866500.0
  },
  {
    "Unnamed: 0": 636,
    "time": 1369353600,
    "open": 6.16,
    "high": 6.53,
    "low": 6.1333,
    "close": 6.4967,
    "volume": 234340500.0
  },
  {
    "Unnamed: 0": 637,
    "time": 1369699200,
    "open": 6.53,
    "high": 7.4687,
    "low": 6.53,
    "close": 7.4533,
    "volume": 286362000.0
  },
  {
    "Unnamed: 0": 638,
    "time": 1369785600,
    "open": 7.4667,
    "high": 7.7,
    "low": 6.6,
    "close": 6.9133,
    "volume": 365599500.0
  },
  {
    "Unnamed: 0": 639,
    "time": 1369872000,
    "open": 7.0667,
    "high": 7.3027,
    "low": 6.7467,
    "close": 7.0,
    "volume": 232486500.0
  },
  {
    "Unnamed: 0": 640,
    "time": 1369958400,
    "open": 6.934,
    "high": 7.096,
    "low": 6.4893,
    "close": 6.4893,
    "volume": 216676500.0
  },
  {
    "Unnamed: 0": 641,
    "time": 1370217600,
    "open": 6.4533,
    "high": 6.7193,
    "low": 5.8833,
    "close": 6.16,
    "volume": 279295500.0
  },
  {
    "Unnamed: 0": 642,
    "time": 1370304000,
    "open": 6.1727,
    "high": 6.428,
    "low": 6.1427,
    "close": 6.3227,
    "volume": 128937000.0
  },
  {
    "Unnamed: 0": 643,
    "time": 1370390400,
    "open": 6.2667,
    "high": 6.5313,
    "low": 5.9407,
    "close": 6.3633,
    "volume": 178788000.0
  },
  {
    "Unnamed: 0": 644,
    "time": 1370476800,
    "open": 6.2867,
    "high": 6.618,
    "low": 6.2867,
    "close": 6.446,
    "volume": 139008000.0
  },
  {
    "Unnamed: 0": 645,
    "time": 1370563200,
    "open": 6.4767,
    "high": 6.86,
    "low": 6.4227,
    "close": 6.8,
    "volume": 154503000.0
  },
  {
    "Unnamed: 0": 646,
    "time": 1370822400,
    "open": 6.7227,
    "high": 6.8347,
    "low": 6.476,
    "close": 6.6,
    "volume": 134262000.0
  },
  {
    "Unnamed: 0": 647,
    "time": 1370908800,
    "open": 6.5713,
    "high": 6.5787,
    "low": 6.27,
    "close": 6.2893,
    "volume": 107361000.0
  },
  {
    "Unnamed: 0": 648,
    "time": 1370995200,
    "open": 6.298,
    "high": 6.6987,
    "low": 6.298,
    "close": 6.522,
    "volume": 133843500.0
  },
  {
    "Unnamed: 0": 649,
    "time": 1371081600,
    "open": 6.4073,
    "high": 6.6333,
    "low": 6.3413,
    "close": 6.5733,
    "volume": 87330000.0
  },
  {
    "Unnamed: 0": 650,
    "time": 1371168000,
    "open": 6.6193,
    "high": 6.8347,
    "low": 6.54,
    "close": 6.69,
    "volume": 95694000.0
  },
  {
    "Unnamed: 0": 651,
    "time": 1371427200,
    "open": 6.8467,
    "high": 6.9833,
    "low": 6.7467,
    "close": 6.794,
    "volume": 103032000.0
  },
  {
    "Unnamed: 0": 652,
    "time": 1371513600,
    "open": 6.8273,
    "high": 6.932,
    "low": 6.6133,
    "close": 6.9073,
    "volume": 129123000.0
  },
  {
    "Unnamed: 0": 653,
    "time": 1371600000,
    "open": 6.8547,
    "high": 7.1113,
    "low": 6.6527,
    "close": 6.934,
    "volume": 125938500.0
  },
  {
    "Unnamed: 0": 654,
    "time": 1371686400,
    "open": 6.9667,
    "high": 7.142,
    "low": 6.63,
    "close": 6.7333,
    "volume": 148359000.0
  },
  {
    "Unnamed: 0": 655,
    "time": 1371772800,
    "open": 6.8667,
    "high": 6.9293,
    "low": 6.5,
    "close": 6.58,
    "volume": 171208500.0
  },
  {
    "Unnamed: 0": 656,
    "time": 1372032000,
    "open": 6.5533,
    "high": 6.858,
    "low": 6.3533,
    "close": 6.8033,
    "volume": 104620500.0
  },
  {
    "Unnamed: 0": 657,
    "time": 1372118400,
    "open": 6.784,
    "high": 6.9467,
    "low": 6.7033,
    "close": 6.7967,
    "volume": 85672500.0
  },
  {
    "Unnamed: 0": 658,
    "time": 1372204800,
    "open": 6.8567,
    "high": 7.0993,
    "low": 6.844,
    "close": 7.0667,
    "volume": 95920500.0
  },
  {
    "Unnamed: 0": 659,
    "time": 1372291200,
    "open": 7.08,
    "high": 7.35,
    "low": 7.0587,
    "close": 7.2833,
    "volume": 127455000.0
  },
  {
    "Unnamed: 0": 660,
    "time": 1372377600,
    "open": 7.3333,
    "high": 7.372,
    "low": 7.114,
    "close": 7.1707,
    "volume": 84156000.0
  },
  {
    "Unnamed: 0": 661,
    "time": 1372636800,
    "open": 7.1973,
    "high": 7.8667,
    "low": 7.1973,
    "close": 7.85,
    "volume": 159403500.0
  },
  {
    "Unnamed: 0": 662,
    "time": 1372723200,
    "open": 7.9,
    "high": 8.126,
    "low": 7.7,
    "close": 7.8667,
    "volume": 177274500.0
  },
  {
    "Unnamed: 0": 663,
    "time": 1372809600,
    "open": 7.834,
    "high": 7.95,
    "low": 7.618,
    "close": 7.6733,
    "volume": 70027500.0
  },
  {
    "Unnamed: 0": 664,
    "time": 1372982400,
    "open": 7.8,
    "high": 8.03,
    "low": 7.6913,
    "close": 8.03,
    "volume": 99724500.0
  },
  {
    "Unnamed: 0": 665,
    "time": 1373241600,
    "open": 7.9847,
    "high": 8.1827,
    "low": 7.9213,
    "close": 8.13,
    "volume": 113974500.0
  },
  {
    "Unnamed: 0": 666,
    "time": 1373328000,
    "open": 8.1587,
    "high": 8.432,
    "low": 8.1273,
    "close": 8.2453,
    "volume": 121951500.0
  },
  {
    "Unnamed: 0": 667,
    "time": 1373414400,
    "open": 8.22,
    "high": 8.3033,
    "low": 8.0527,
    "close": 8.2733,
    "volume": 81409500.0
  },
  {
    "Unnamed: 0": 668,
    "time": 1373500800,
    "open": 8.3333,
    "high": 8.406,
    "low": 8.1567,
    "close": 8.3787,
    "volume": 107755500.0
  },
  {
    "Unnamed: 0": 669,
    "time": 1373587200,
    "open": 8.3127,
    "high": 8.6653,
    "low": 8.3007,
    "close": 8.6547,
    "volume": 166258500.0
  },
  {
    "Unnamed: 0": 670,
    "time": 1373846400,
    "open": 8.6667,
    "high": 8.92,
    "low": 8.4547,
    "close": 8.5153,
    "volume": 144150000.0
  },
  {
    "Unnamed: 0": 671,
    "time": 1373932800,
    "open": 8.5153,
    "high": 8.5833,
    "low": 7.096,
    "close": 7.1133,
    "volume": 469743000.0
  },
  {
    "Unnamed: 0": 672,
    "time": 1374019200,
    "open": 7.1833,
    "high": 8.1493,
    "low": 6.9667,
    "close": 8.1,
    "volume": 379722000.0
  },
  {
    "Unnamed: 0": 673,
    "time": 1374105600,
    "open": 8.114,
    "high": 8.22,
    "low": 7.7453,
    "close": 7.8707,
    "volume": 166929000.0
  },
  {
    "Unnamed: 0": 674,
    "time": 1374192000,
    "open": 8.0,
    "high": 8.0367,
    "low": 7.7673,
    "close": 7.9813,
    "volume": 85578000.0
  },
  {
    "Unnamed: 0": 675,
    "time": 1374451200,
    "open": 8.0453,
    "high": 8.4453,
    "low": 7.986,
    "close": 8.14,
    "volume": 143059500.0
  },
  {
    "Unnamed: 0": 676,
    "time": 1374537600,
    "open": 8.2133,
    "high": 8.3707,
    "low": 8.1213,
    "close": 8.1867,
    "volume": 111156000.0
  },
  {
    "Unnamed: 0": 677,
    "time": 1374624000,
    "open": 8.2667,
    "high": 8.316,
    "low": 7.9707,
    "close": 8.126,
    "volume": 99454500.0
  },
  {
    "Unnamed: 0": 678,
    "time": 1374710400,
    "open": 8.1,
    "high": 8.3167,
    "low": 8.0127,
    "close": 8.2847,
    "volume": 76276500.0
  },
  {
    "Unnamed: 0": 679,
    "time": 1374796800,
    "open": 8.424,
    "high": 8.8633,
    "low": 8.3,
    "close": 8.6273,
    "volume": 139750500.0
  },
  {
    "Unnamed: 0": 680,
    "time": 1375056000,
    "open": 8.7013,
    "high": 9.0247,
    "low": 8.5273,
    "close": 8.9773,
    "volume": 141123000.0
  },
  {
    "Unnamed: 0": 681,
    "time": 1375142400,
    "open": 9.0133,
    "high": 9.166,
    "low": 8.5453,
    "close": 8.8,
    "volume": 190620000.0
  },
  {
    "Unnamed: 0": 682,
    "time": 1375228800,
    "open": 8.8593,
    "high": 8.998,
    "low": 8.7633,
    "close": 8.9793,
    "volume": 92283000.0
  },
  {
    "Unnamed: 0": 683,
    "time": 1375315200,
    "open": 9.0,
    "high": 9.1087,
    "low": 8.842,
    "close": 9.0673,
    "volume": 77371500.0
  },
  {
    "Unnamed: 0": 684,
    "time": 1375401600,
    "open": 9.1,
    "high": 9.26,
    "low": 8.9073,
    "close": 9.2467,
    "volume": 90321000.0
  },
  {
    "Unnamed: 0": 685,
    "time": 1375660800,
    "open": 9.2587,
    "high": 9.666,
    "low": 9.1533,
    "close": 9.6467,
    "volume": 148099500.0
  },
  {
    "Unnamed: 0": 686,
    "time": 1375747200,
    "open": 9.71,
    "high": 9.78,
    "low": 9.4067,
    "close": 9.4833,
    "volume": 133714500.0
  },
  {
    "Unnamed: 0": 687,
    "time": 1375833600,
    "open": 9.5167,
    "high": 10.3667,
    "low": 8.824,
    "close": 10.2133,
    "volume": 264238500.0
  },
  {
    "Unnamed: 0": 688,
    "time": 1375920000,
    "open": 10.2953,
    "high": 10.592,
    "low": 9.9467,
    "close": 10.2167,
    "volume": 387346500.0
  },
  {
    "Unnamed: 0": 689,
    "time": 1376006400,
    "open": 10.26,
    "high": 10.3967,
    "low": 10.0833,
    "close": 10.2,
    "volume": 129208500.0
  },
  {
    "Unnamed: 0": 690,
    "time": 1376265600,
    "open": 10.21,
    "high": 10.21,
    "low": 9.47,
    "close": 9.8633,
    "volume": 215790000.0
  },
  {
    "Unnamed: 0": 691,
    "time": 1376352000,
    "open": 9.916,
    "high": 10.0,
    "low": 9.614,
    "close": 9.62,
    "volume": 124554000.0
  },
  {
    "Unnamed: 0": 692,
    "time": 1376438400,
    "open": 9.65,
    "high": 9.6953,
    "low": 9.2033,
    "close": 9.2347,
    "volume": 166930500.0
  },
  {
    "Unnamed: 0": 693,
    "time": 1376524800,
    "open": 9.3333,
    "high": 9.5733,
    "low": 9.0,
    "close": 9.3533,
    "volume": 147001500.0
  },
  {
    "Unnamed: 0": 694,
    "time": 1376611200,
    "open": 9.3333,
    "high": 9.594,
    "low": 9.3067,
    "close": 9.462,
    "volume": 101158500.0
  },
  {
    "Unnamed: 0": 695,
    "time": 1376870400,
    "open": 9.4667,
    "high": 9.8253,
    "low": 9.4667,
    "close": 9.7133,
    "volume": 116574000.0
  },
  {
    "Unnamed: 0": 696,
    "time": 1376956800,
    "open": 9.7667,
    "high": 10.01,
    "low": 9.7667,
    "close": 9.9873,
    "volume": 90135000.0
  },
  {
    "Unnamed: 0": 697,
    "time": 1377043200,
    "open": 9.998,
    "high": 10.0727,
    "low": 9.75,
    "close": 9.7867,
    "volume": 89446500.0
  },
  {
    "Unnamed: 0": 698,
    "time": 1377129600,
    "open": 9.8267,
    "high": 10.4987,
    "low": 9.8267,
    "close": 10.496,
    "volume": 151780500.0
  },
  {
    "Unnamed: 0": 699,
    "time": 1377216000,
    "open": 10.4947,
    "high": 10.82,
    "low": 10.3333,
    "close": 10.7833,
    "volume": 187560000.0
  },
  {
    "Unnamed: 0": 700,
    "time": 1377475200,
    "open": 10.7867,
    "high": 11.5333,
    "low": 10.6833,
    "close": 11.0707,
    "volume": 350391000.0
  },
  {
    "Unnamed: 0": 701,
    "time": 1377561600,
    "open": 11.0967,
    "high": 11.2533,
    "low": 10.712,
    "close": 11.1873,
    "volume": 248074500.0
  },
  {
    "Unnamed: 0": 702,
    "time": 1377648000,
    "open": 11.1867,
    "high": 11.4333,
    "low": 10.8833,
    "close": 11.0173,
    "volume": 209382000.0
  },
  {
    "Unnamed: 0": 703,
    "time": 1377734400,
    "open": 11.1573,
    "high": 11.1867,
    "low": 10.834,
    "close": 11.0333,
    "volume": 134815500.0
  },
  {
    "Unnamed: 0": 704,
    "time": 1377820800,
    "open": 11.1167,
    "high": 11.2967,
    "low": 10.9307,
    "close": 11.2893,
    "volume": 161145000.0
  },
  {
    "Unnamed: 0": 705,
    "time": 1378166400,
    "open": 11.3333,
    "high": 11.6587,
    "low": 11.0933,
    "close": 11.272,
    "volume": 174235500.0
  },
  {
    "Unnamed: 0": 706,
    "time": 1378252800,
    "open": 11.3333,
    "high": 11.4413,
    "low": 11.0373,
    "close": 11.3987,
    "volume": 164263500.0
  },
  {
    "Unnamed: 0": 707,
    "time": 1378339200,
    "open": 11.458,
    "high": 11.4993,
    "low": 11.2167,
    "close": 11.3333,
    "volume": 95404500.0
  },
  {
    "Unnamed: 0": 708,
    "time": 1378425600,
    "open": 11.3267,
    "high": 11.3333,
    "low": 11.01,
    "close": 11.0933,
    "volume": 122739000.0
  },
  {
    "Unnamed: 0": 709,
    "time": 1378684800,
    "open": 11.1333,
    "high": 11.1333,
    "low": 10.5673,
    "close": 10.6113,
    "volume": 207159000.0
  },
  {
    "Unnamed: 0": 710,
    "time": 1378771200,
    "open": 10.6487,
    "high": 11.1667,
    "low": 10.632,
    "close": 11.1053,
    "volume": 128748000.0
  },
  {
    "Unnamed: 0": 711,
    "time": 1378857600,
    "open": 11.1367,
    "high": 11.2073,
    "low": 10.8087,
    "close": 10.9247,
    "volume": 83227500.0
  },
  {
    "Unnamed: 0": 712,
    "time": 1378944000,
    "open": 10.934,
    "high": 11.1173,
    "low": 10.5273,
    "close": 10.8267,
    "volume": 90027000.0
  },
  {
    "Unnamed: 0": 713,
    "time": 1379030400,
    "open": 10.9267,
    "high": 11.0913,
    "low": 10.8107,
    "close": 11.0393,
    "volume": 75963000.0
  },
  {
    "Unnamed: 0": 714,
    "time": 1379289600,
    "open": 11.2,
    "high": 11.39,
    "low": 11.036,
    "close": 11.06,
    "volume": 109735500.0
  },
  {
    "Unnamed: 0": 715,
    "time": 1379376000,
    "open": 11.066,
    "high": 11.228,
    "low": 10.8907,
    "close": 11.0933,
    "volume": 78295500.0
  },
  {
    "Unnamed: 0": 716,
    "time": 1379462400,
    "open": 11.094,
    "high": 11.3233,
    "low": 10.9467,
    "close": 11.3,
    "volume": 78660000.0
  },
  {
    "Unnamed: 0": 717,
    "time": 1379548800,
    "open": 11.31,
    "high": 12.0313,
    "low": 11.1,
    "close": 11.8793,
    "volume": 224395500.0
  },
  {
    "Unnamed: 0": 718,
    "time": 1379635200,
    "open": 11.8333,
    "high": 12.3887,
    "low": 11.7947,
    "close": 12.2593,
    "volume": 194923500.0
  },
  {
    "Unnamed: 0": 719,
    "time": 1379894400,
    "open": 12.33,
    "high": 12.3653,
    "low": 11.8073,
    "close": 12.0073,
    "volume": 119229000.0
  },
  {
    "Unnamed: 0": 720,
    "time": 1379980800,
    "open": 12.074,
    "high": 12.3307,
    "low": 11.8433,
    "close": 12.144,
    "volume": 90906000.0
  },
  {
    "Unnamed: 0": 721,
    "time": 1380067200,
    "open": 12.1067,
    "high": 12.42,
    "low": 12.02,
    "close": 12.3727,
    "volume": 117744000.0
  },
  {
    "Unnamed: 0": 722,
    "time": 1380153600,
    "open": 12.4087,
    "high": 12.6453,
    "low": 12.3333,
    "close": 12.5647,
    "volume": 95916000.0
  },
  {
    "Unnamed: 0": 723,
    "time": 1380240000,
    "open": 12.5867,
    "high": 12.7533,
    "low": 12.4287,
    "close": 12.7467,
    "volume": 84856500.0
  },
  {
    "Unnamed: 0": 724,
    "time": 1380499200,
    "open": 12.6933,
    "high": 12.9667,
    "low": 12.5207,
    "close": 12.87,
    "volume": 129867000.0
  },
  {
    "Unnamed: 0": 725,
    "time": 1380585600,
    "open": 12.9067,
    "high": 12.9933,
    "low": 12.558,
    "close": 12.8713,
    "volume": 112054500.0
  },
  {
    "Unnamed: 0": 726,
    "time": 1380672000,
    "open": 12.8167,
    "high": 12.8733,
    "low": 11.6933,
    "close": 11.9033,
    "volume": 298063500.0
  },
  {
    "Unnamed: 0": 727,
    "time": 1380758400,
    "open": 11.7913,
    "high": 11.9793,
    "low": 11.2,
    "close": 11.5193,
    "volume": 342652500.0
  },
  {
    "Unnamed: 0": 728,
    "time": 1380844800,
    "open": 11.5333,
    "high": 12.2333,
    "low": 11.51,
    "close": 12.2307,
    "volume": 209007000.0
  },
  {
    "Unnamed: 0": 729,
    "time": 1381104000,
    "open": 12.3107,
    "high": 12.4487,
    "low": 12.0173,
    "close": 12.1927,
    "volume": 166999500.0
  },
  {
    "Unnamed: 0": 730,
    "time": 1381190400,
    "open": 12.2667,
    "high": 12.3953,
    "low": 11.5333,
    "close": 11.6833,
    "volume": 198939000.0
  },
  {
    "Unnamed: 0": 731,
    "time": 1381276800,
    "open": 11.7,
    "high": 11.8,
    "low": 10.7667,
    "close": 11.2533,
    "volume": 220770000.0
  },
  {
    "Unnamed: 0": 732,
    "time": 1381363200,
    "open": 11.2533,
    "high": 11.7167,
    "low": 11.22,
    "close": 11.5327,
    "volume": 129027000.0
  },
  {
    "Unnamed: 0": 733,
    "time": 1381449600,
    "open": 11.578,
    "high": 11.9993,
    "low": 11.4,
    "close": 11.98,
    "volume": 119569500.0
  },
  {
    "Unnamed: 0": 734,
    "time": 1381708800,
    "open": 11.8033,
    "high": 12.1667,
    "low": 11.61,
    "close": 12.022,
    "volume": 112860000.0
  },
  {
    "Unnamed: 0": 735,
    "time": 1381795200,
    "open": 12.022,
    "high": 12.586,
    "low": 12.022,
    "close": 12.3133,
    "volume": 159427500.0
  },
  {
    "Unnamed: 0": 736,
    "time": 1381881600,
    "open": 12.3333,
    "high": 12.4867,
    "low": 12.1393,
    "close": 12.2133,
    "volume": 119692500.0
  },
  {
    "Unnamed: 0": 737,
    "time": 1381968000,
    "open": 12.2667,
    "high": 12.3333,
    "low": 12.066,
    "close": 12.24,
    "volume": 97383000.0
  },
  {
    "Unnamed: 0": 738,
    "time": 1382054400,
    "open": 12.2873,
    "high": 12.3973,
    "low": 12.0733,
    "close": 12.1627,
    "volume": 85054500.0
  },
  {
    "Unnamed: 0": 739,
    "time": 1382313600,
    "open": 12.2933,
    "high": 12.3127,
    "low": 11.4,
    "close": 11.5593,
    "volume": 165351000.0
  },
  {
    "Unnamed: 0": 740,
    "time": 1382400000,
    "open": 11.6,
    "high": 11.852,
    "low": 11.074,
    "close": 11.396,
    "volume": 166023000.0
  },
  {
    "Unnamed: 0": 741,
    "time": 1382486400,
    "open": 11.38,
    "high": 11.454,
    "low": 10.6767,
    "close": 10.8887,
    "volume": 190072500.0
  },
  {
    "Unnamed: 0": 742,
    "time": 1382572800,
    "open": 10.92,
    "high": 11.8307,
    "low": 10.8553,
    "close": 11.8167,
    "volume": 158160000.0
  },
  {
    "Unnamed: 0": 743,
    "time": 1382659200,
    "open": 11.5407,
    "high": 11.814,
    "low": 11.12,
    "close": 11.2833,
    "volume": 110428500.0
  },
  {
    "Unnamed: 0": 744,
    "time": 1382918400,
    "open": 11.3107,
    "high": 11.4967,
    "low": 10.8073,
    "close": 10.84,
    "volume": 112183500.0
  },
  {
    "Unnamed: 0": 745,
    "time": 1383004800,
    "open": 10.84,
    "high": 11.06,
    "low": 10.2,
    "close": 10.934,
    "volume": 205161000.0
  },
  {
    "Unnamed: 0": 746,
    "time": 1383091200,
    "open": 11.0467,
    "high": 11.1787,
    "low": 10.5333,
    "close": 10.5333,
    "volume": 121746000.0
  },
  {
    "Unnamed: 0": 747,
    "time": 1383177600,
    "open": 10.52,
    "high": 10.8293,
    "low": 10.22,
    "close": 10.71,
    "volume": 131301000.0
  },
  {
    "Unnamed: 0": 748,
    "time": 1383264000,
    "open": 10.75,
    "high": 11.06,
    "low": 10.6627,
    "close": 10.8667,
    "volume": 104220000.0
  },
  {
    "Unnamed: 0": 749,
    "time": 1383523200,
    "open": 10.8667,
    "high": 11.7987,
    "low": 10.8667,
    "close": 11.7533,
    "volume": 188814000.0
  },
  {
    "Unnamed: 0": 750,
    "time": 1383609600,
    "open": 11.68,
    "high": 12.1313,
    "low": 10.2667,
    "close": 10.3333,
    "volume": 319066500.0
  },
  {
    "Unnamed: 0": 751,
    "time": 1383696000,
    "open": 10.44,
    "high": 10.7153,
    "low": 9.7573,
    "close": 10.0,
    "volume": 442978500.0
  },
  {
    "Unnamed: 0": 752,
    "time": 1383782400,
    "open": 9.8667,
    "high": 10.1333,
    "low": 9.1747,
    "close": 9.2007,
    "volume": 319876500.0
  },
  {
    "Unnamed: 0": 753,
    "time": 1383868800,
    "open": 9.1667,
    "high": 9.3833,
    "low": 8.8213,
    "close": 9.2553,
    "volume": 316498500.0
  },
  {
    "Unnamed: 0": 754,
    "time": 1384128000,
    "open": 9.1,
    "high": 9.6947,
    "low": 9.1,
    "close": 9.66,
    "volume": 202396500.0
  },
  {
    "Unnamed: 0": 755,
    "time": 1384214400,
    "open": 9.7667,
    "high": 9.8,
    "low": 9.0787,
    "close": 9.3933,
    "volume": 213652500.0
  },
  {
    "Unnamed: 0": 756,
    "time": 1384300800,
    "open": 9.39,
    "high": 9.4913,
    "low": 9.0893,
    "close": 9.2707,
    "volume": 175584000.0
  },
  {
    "Unnamed: 0": 757,
    "time": 1384387200,
    "open": 9.3333,
    "high": 9.3847,
    "low": 8.9407,
    "close": 9.1573,
    "volume": 175161000.0
  },
  {
    "Unnamed: 0": 758,
    "time": 1384473600,
    "open": 9.2,
    "high": 9.2627,
    "low": 8.9567,
    "close": 9.0013,
    "volume": 143160000.0
  },
  {
    "Unnamed: 0": 759,
    "time": 1384732800,
    "open": 9.0327,
    "high": 9.1,
    "low": 7.974,
    "close": 7.9893,
    "volume": 333507000.0
  },
  {
    "Unnamed: 0": 760,
    "time": 1384819200,
    "open": 8.0293,
    "high": 8.6,
    "low": 7.7033,
    "close": 8.52,
    "volume": 282606000.0
  },
  {
    "Unnamed: 0": 761,
    "time": 1384905600,
    "open": 8.5,
    "high": 8.5067,
    "low": 7.9373,
    "close": 8.0567,
    "volume": 199353000.0
  },
  {
    "Unnamed: 0": 762,
    "time": 1384992000,
    "open": 8.0727,
    "high": 8.3253,
    "low": 8.0067,
    "close": 8.11,
    "volume": 172042500.0
  },
  {
    "Unnamed: 0": 763,
    "time": 1385078400,
    "open": 8.1533,
    "high": 8.1833,
    "low": 7.862,
    "close": 8.1,
    "volume": 162112500.0
  },
  {
    "Unnamed: 0": 764,
    "time": 1385337600,
    "open": 8.0893,
    "high": 8.3893,
    "low": 8.02,
    "close": 8.046,
    "volume": 150082500.0
  },
  {
    "Unnamed: 0": 765,
    "time": 1385424000,
    "open": 8.098,
    "high": 8.1813,
    "low": 7.74,
    "close": 8.066,
    "volume": 201268500.0
  },
  {
    "Unnamed: 0": 766,
    "time": 1385510400,
    "open": 8.1313,
    "high": 8.5327,
    "low": 7.968,
    "close": 8.5253,
    "volume": 178762500.0
  },
  {
    "Unnamed: 0": 767,
    "time": 1385683200,
    "open": 8.6207,
    "high": 8.706,
    "low": 8.4333,
    "close": 8.4413,
    "volume": 142236000.0
  },
  {
    "Unnamed: 0": 768,
    "time": 1385942400,
    "open": 8.48,
    "high": 8.57,
    "low": 8.258,
    "close": 8.43,
    "volume": 110358000.0
  },
  {
    "Unnamed: 0": 769,
    "time": 1386028800,
    "open": 8.4447,
    "high": 9.6627,
    "low": 8.2867,
    "close": 9.62,
    "volume": 374767500.0
  },
  {
    "Unnamed: 0": 770,
    "time": 1386115200,
    "open": 9.7673,
    "high": 9.7993,
    "low": 9.142,
    "close": 9.2567,
    "volume": 191470500.0
  },
  {
    "Unnamed: 0": 771,
    "time": 1386201600,
    "open": 9.3773,
    "high": 9.5567,
    "low": 9.3,
    "close": 9.334,
    "volume": 134154000.0
  },
  {
    "Unnamed: 0": 772,
    "time": 1386288000,
    "open": 9.412,
    "high": 9.5293,
    "low": 9.0867,
    "close": 9.1387,
    "volume": 115554000.0
  },
  {
    "Unnamed: 0": 773,
    "time": 1386547200,
    "open": 9.2067,
    "high": 9.4947,
    "low": 8.9473,
    "close": 9.45,
    "volume": 150270000.0
  },
  {
    "Unnamed: 0": 774,
    "time": 1386633600,
    "open": 9.3993,
    "high": 9.7247,
    "low": 9.2413,
    "close": 9.4973,
    "volume": 172441500.0
  },
  {
    "Unnamed: 0": 775,
    "time": 1386720000,
    "open": 9.4807,
    "high": 9.5767,
    "low": 9.298,
    "close": 9.32,
    "volume": 111934500.0
  },
  {
    "Unnamed: 0": 776,
    "time": 1386806400,
    "open": 9.37,
    "high": 9.8827,
    "low": 9.2353,
    "close": 9.8133,
    "volume": 173362500.0
  },
  {
    "Unnamed: 0": 777,
    "time": 1386892800,
    "open": 9.8553,
    "high": 10.12,
    "low": 9.8,
    "close": 9.816,
    "volume": 174357000.0
  },
  {
    "Unnamed: 0": 778,
    "time": 1387152000,
    "open": 9.8433,
    "high": 10.03,
    "low": 9.74,
    "close": 9.8227,
    "volume": 109501500.0
  },
  {
    "Unnamed: 0": 779,
    "time": 1387238400,
    "open": 9.822,
    "high": 10.3087,
    "low": 9.7533,
    "close": 10.18,
    "volume": 174391500.0
  },
  {
    "Unnamed: 0": 780,
    "time": 1387324800,
    "open": 10.18,
    "high": 10.3267,
    "low": 9.73,
    "close": 9.8633,
    "volume": 182674500.0
  },
  {
    "Unnamed: 0": 781,
    "time": 1387411200,
    "open": 9.8667,
    "high": 9.9993,
    "low": 9.2733,
    "close": 9.3733,
    "volume": 202656000.0
  },
  {
    "Unnamed: 0": 782,
    "time": 1387497600,
    "open": 9.4007,
    "high": 9.624,
    "low": 9.3767,
    "close": 9.516,
    "volume": 123055500.0
  },
  {
    "Unnamed: 0": 783,
    "time": 1387756800,
    "open": 9.6327,
    "high": 9.7493,
    "low": 9.5067,
    "close": 9.6433,
    "volume": 88005000.0
  },
  {
    "Unnamed: 0": 784,
    "time": 1387843200,
    "open": 9.7567,
    "high": 10.3327,
    "low": 9.686,
    "close": 10.068,
    "volume": 159850500.0
  },
  {
    "Unnamed: 0": 785,
    "time": 1388016000,
    "open": 10.21,
    "high": 10.5333,
    "low": 10.1767,
    "close": 10.4067,
    "volume": 118942500.0
  },
  {
    "Unnamed: 0": 786,
    "time": 1388102400,
    "open": 10.368,
    "high": 10.4527,
    "low": 10.0333,
    "close": 10.0333,
    "volume": 93999000.0
  },
  {
    "Unnamed: 0": 787,
    "time": 1388361600,
    "open": 10.0747,
    "high": 10.3207,
    "low": 10.0333,
    "close": 10.1533,
    "volume": 74286000.0
  },
  {
    "Unnamed: 0": 788,
    "time": 1388448000,
    "open": 10.1993,
    "high": 10.2627,
    "low": 9.9107,
    "close": 10.0327,
    "volume": 72408000.0
  },
  {
    "Unnamed: 0": 789,
    "time": 1388620800,
    "open": 10.04,
    "high": 10.1653,
    "low": 9.77,
    "close": 10.0093,
    "volume": 102918000.0
  },
  {
    "Unnamed: 0": 790,
    "time": 1388707200,
    "open": 10.0067,
    "high": 10.1467,
    "low": 9.9067,
    "close": 9.932,
    "volume": 78061500.0
  },
  {
    "Unnamed: 0": 791,
    "time": 1388966400,
    "open": 10.0,
    "high": 10.032,
    "low": 9.682,
    "close": 9.776,
    "volume": 89131500.0
  },
  {
    "Unnamed: 0": 792,
    "time": 1389052800,
    "open": 9.8,
    "high": 10.0267,
    "low": 9.6833,
    "close": 9.9207,
    "volume": 83844000.0
  },
  {
    "Unnamed: 0": 793,
    "time": 1389139200,
    "open": 9.9573,
    "high": 10.2467,
    "low": 9.8673,
    "close": 10.1,
    "volume": 101304000.0
  },
  {
    "Unnamed: 0": 794,
    "time": 1389225600,
    "open": 10.0933,
    "high": 10.2287,
    "low": 9.79,
    "close": 9.8567,
    "volume": 88711500.0
  },
  {
    "Unnamed: 0": 795,
    "time": 1389312000,
    "open": 9.874,
    "high": 9.9667,
    "low": 9.4833,
    "close": 9.73,
    "volume": 126364500.0
  },
  {
    "Unnamed: 0": 796,
    "time": 1389571200,
    "open": 9.76,
    "high": 9.8,
    "low": 9.188,
    "close": 9.3167,
    "volume": 84717000.0
  },
  {
    "Unnamed: 0": 797,
    "time": 1389657600,
    "open": 9.2933,
    "high": 11.172,
    "low": 9.1113,
    "close": 11.0167,
    "volume": 379350000.0
  },
  {
    "Unnamed: 0": 798,
    "time": 1389744000,
    "open": 10.98,
    "high": 11.4907,
    "low": 10.8067,
    "close": 10.942,
    "volume": 274327500.0
  },
  {
    "Unnamed: 0": 799,
    "time": 1389830400,
    "open": 11.026,
    "high": 11.5133,
    "low": 10.7773,
    "close": 11.452,
    "volume": 160425000.0
  },
  {
    "Unnamed: 0": 800,
    "time": 1389916800,
    "open": 11.4147,
    "high": 11.5467,
    "low": 11.1967,
    "close": 11.36,
    "volume": 124987500.0
  },
  {
    "Unnamed: 0": 801,
    "time": 1390262400,
    "open": 11.3333,
    "high": 11.8193,
    "low": 11.3,
    "close": 11.7867,
    "volume": 130549500.0
  },
  {
    "Unnamed: 0": 802,
    "time": 1390348800,
    "open": 11.9833,
    "high": 12.0213,
    "low": 11.6507,
    "close": 11.904,
    "volume": 90628500.0
  },
  {
    "Unnamed: 0": 803,
    "time": 1390435200,
    "open": 11.8133,
    "high": 12.1587,
    "low": 11.5613,
    "close": 12.0,
    "volume": 104628000.0
  },
  {
    "Unnamed: 0": 804,
    "time": 1390521600,
    "open": 11.862,
    "high": 12.0333,
    "low": 11.554,
    "close": 11.5667,
    "volume": 101746500.0
  },
  {
    "Unnamed: 0": 805,
    "time": 1390780800,
    "open": 11.7,
    "high": 11.8613,
    "low": 10.9807,
    "close": 11.1867,
    "volume": 115896000.0
  },
  {
    "Unnamed: 0": 806,
    "time": 1390867200,
    "open": 11.308,
    "high": 11.9593,
    "low": 11.2927,
    "close": 11.9593,
    "volume": 80989500.0
  },
  {
    "Unnamed: 0": 807,
    "time": 1390953600,
    "open": 11.9287,
    "high": 11.9393,
    "low": 11.542,
    "close": 11.7867,
    "volume": 77025000.0
  },
  {
    "Unnamed: 0": 808,
    "time": 1391040000,
    "open": 11.6833,
    "high": 12.3187,
    "low": 11.6833,
    "close": 12.2333,
    "volume": 107673000.0
  },
  {
    "Unnamed: 0": 809,
    "time": 1391126400,
    "open": 12.3333,
    "high": 12.4,
    "low": 11.9007,
    "close": 12.0773,
    "volume": 84319500.0
  },
  {
    "Unnamed: 0": 810,
    "time": 1391385600,
    "open": 11.6667,
    "high": 12.3253,
    "low": 11.6667,
    "close": 11.8187,
    "volume": 89644500.0
  },
  {
    "Unnamed: 0": 811,
    "time": 1391472000,
    "open": 11.8,
    "high": 12.1067,
    "low": 11.7467,
    "close": 11.922,
    "volume": 62623500.0
  },
  {
    "Unnamed: 0": 812,
    "time": 1391558400,
    "open": 11.87,
    "high": 12.0393,
    "low": 11.2907,
    "close": 11.6533,
    "volume": 93388500.0
  },
  {
    "Unnamed: 0": 813,
    "time": 1391644800,
    "open": 11.668,
    "high": 12.0073,
    "low": 11.628,
    "close": 11.8953,
    "volume": 73384500.0
  },
  {
    "Unnamed: 0": 814,
    "time": 1391731200,
    "open": 12.032,
    "high": 12.488,
    "low": 11.9,
    "close": 12.4733,
    "volume": 117148500.0
  },
  {
    "Unnamed: 0": 815,
    "time": 1391990400,
    "open": 12.5627,
    "high": 13.2867,
    "low": 12.42,
    "close": 13.1027,
    "volume": 164770500.0
  },
  {
    "Unnamed: 0": 816,
    "time": 1392076800,
    "open": 13.2,
    "high": 13.48,
    "low": 12.8467,
    "close": 12.9733,
    "volume": 140068500.0
  },
  {
    "Unnamed: 0": 817,
    "time": 1392163200,
    "open": 13.1067,
    "high": 13.218,
    "low": 12.9547,
    "close": 13.0007,
    "volume": 66439500.0
  },
  {
    "Unnamed: 0": 818,
    "time": 1392249600,
    "open": 12.9333,
    "high": 13.5147,
    "low": 12.684,
    "close": 13.1313,
    "volume": 105280500.0
  },
  {
    "Unnamed: 0": 819,
    "time": 1392336000,
    "open": 13.2073,
    "high": 13.4587,
    "low": 13.1273,
    "close": 13.1933,
    "volume": 80040000.0
  },
  {
    "Unnamed: 0": 820,
    "time": 1392681600,
    "open": 13.1333,
    "high": 13.8833,
    "low": 13.1333,
    "close": 13.5567,
    "volume": 117477000.0
  },
  {
    "Unnamed: 0": 821,
    "time": 1392768000,
    "open": 13.6893,
    "high": 15.0,
    "low": 12.8867,
    "close": 14.5393,
    "volume": 202486500.0
  },
  {
    "Unnamed: 0": 822,
    "time": 1392854400,
    "open": 14.446,
    "high": 14.5667,
    "low": 13.7513,
    "close": 13.968,
    "volume": 231760500.0
  },
  {
    "Unnamed: 0": 823,
    "time": 1392940800,
    "open": 14.0327,
    "high": 14.2653,
    "low": 13.946,
    "close": 13.9947,
    "volume": 102037500.0
  },
  {
    "Unnamed: 0": 824,
    "time": 1393200000,
    "open": 13.98,
    "high": 14.5573,
    "low": 13.876,
    "close": 14.4867,
    "volume": 108903000.0
  },
  {
    "Unnamed: 0": 825,
    "time": 1393286400,
    "open": 14.6533,
    "high": 17.28,
    "low": 14.6533,
    "close": 16.8467,
    "volume": 420369000.0
  },
  {
    "Unnamed: 0": 826,
    "time": 1393372800,
    "open": 16.9333,
    "high": 17.6667,
    "low": 16.3693,
    "close": 17.44,
    "volume": 312486000.0
  },
  {
    "Unnamed: 0": 827,
    "time": 1393459200,
    "open": 17.5333,
    "high": 17.83,
    "low": 16.5553,
    "close": 16.804,
    "volume": 223077000.0
  },
  {
    "Unnamed: 0": 828,
    "time": 1393545600,
    "open": 16.9333,
    "high": 16.94,
    "low": 16.17,
    "close": 16.2567,
    "volume": 180037500.0
  },
  {
    "Unnamed: 0": 829,
    "time": 1393804800,
    "open": 15.4667,
    "high": 16.7767,
    "low": 15.4667,
    "close": 16.6667,
    "volume": 165219000.0
  },
  {
    "Unnamed: 0": 830,
    "time": 1393891200,
    "open": 16.91,
    "high": 17.386,
    "low": 16.8553,
    "close": 16.964,
    "volume": 108879000.0
  },
  {
    "Unnamed: 0": 831,
    "time": 1393977600,
    "open": 17.2,
    "high": 17.2653,
    "low": 16.7867,
    "close": 16.82,
    "volume": 72594000.0
  },
  {
    "Unnamed: 0": 832,
    "time": 1394064000,
    "open": 16.9333,
    "high": 17.1667,
    "low": 16.63,
    "close": 16.86,
    "volume": 94290000.0
  },
  {
    "Unnamed: 0": 833,
    "time": 1394150400,
    "open": 16.8667,
    "high": 16.99,
    "low": 16.294,
    "close": 16.3767,
    "volume": 95437500.0
  },
  {
    "Unnamed: 0": 834,
    "time": 1394409600,
    "open": 16.27,
    "high": 16.4387,
    "low": 15.7373,
    "close": 15.8193,
    "volume": 97983000.0
  },
  {
    "Unnamed: 0": 835,
    "time": 1394496000,
    "open": 15.8333,
    "high": 16.3067,
    "low": 15.4953,
    "close": 15.5033,
    "volume": 109213500.0
  },
  {
    "Unnamed: 0": 836,
    "time": 1394582400,
    "open": 15.4733,
    "high": 16.2993,
    "low": 15.2647,
    "close": 16.1927,
    "volume": 123525000.0
  },
  {
    "Unnamed: 0": 837,
    "time": 1394668800,
    "open": 16.248,
    "high": 16.33,
    "low": 15.6,
    "close": 15.7667,
    "volume": 79090500.0
  },
  {
    "Unnamed: 0": 838,
    "time": 1394755200,
    "open": 15.6467,
    "high": 15.8527,
    "low": 15.2213,
    "close": 15.3333,
    "volume": 103077000.0
  },
  {
    "Unnamed: 0": 839,
    "time": 1395014400,
    "open": 15.51,
    "high": 15.862,
    "low": 15.3667,
    "close": 15.7067,
    "volume": 76896000.0
  },
  {
    "Unnamed: 0": 840,
    "time": 1395100800,
    "open": 15.7047,
    "high": 16.1,
    "low": 15.6,
    "close": 16.0467,
    "volume": 78610500.0
  },
  {
    "Unnamed: 0": 841,
    "time": 1395187200,
    "open": 16.1613,
    "high": 16.2133,
    "low": 15.5673,
    "close": 15.72,
    "volume": 62955000.0
  },
  {
    "Unnamed: 0": 842,
    "time": 1395273600,
    "open": 15.7333,
    "high": 15.95,
    "low": 15.5573,
    "close": 15.6133,
    "volume": 47638500.0
  },
  {
    "Unnamed: 0": 843,
    "time": 1395360000,
    "open": 15.7333,
    "high": 15.76,
    "low": 15.1667,
    "close": 15.18,
    "volume": 104617500.0
  },
  {
    "Unnamed: 0": 844,
    "time": 1395619200,
    "open": 15.3867,
    "high": 15.4173,
    "low": 14.018,
    "close": 14.7233,
    "volume": 142279500.0
  },
  {
    "Unnamed: 0": 845,
    "time": 1395705600,
    "open": 14.746,
    "high": 15.1367,
    "low": 14.5267,
    "close": 14.7193,
    "volume": 99859500.0
  },
  {
    "Unnamed: 0": 846,
    "time": 1395792000,
    "open": 14.8113,
    "high": 14.9333,
    "low": 14.09,
    "close": 14.1793,
    "volume": 87933000.0
  },
  {
    "Unnamed: 0": 847,
    "time": 1395878400,
    "open": 14.1347,
    "high": 14.252,
    "low": 13.5333,
    "close": 13.7153,
    "volume": 120972000.0
  },
  {
    "Unnamed: 0": 848,
    "time": 1395964800,
    "open": 13.7367,
    "high": 14.448,
    "low": 13.734,
    "close": 14.294,
    "volume": 125509500.0
  },
  {
    "Unnamed: 0": 849,
    "time": 1396224000,
    "open": 14.3267,
    "high": 14.4513,
    "low": 13.7593,
    "close": 13.8533,
    "volume": 106504500.0
  },
  {
    "Unnamed: 0": 850,
    "time": 1396310400,
    "open": 13.88,
    "high": 14.544,
    "low": 13.8667,
    "close": 14.528,
    "volume": 93630000.0
  },
  {
    "Unnamed: 0": 851,
    "time": 1396396800,
    "open": 14.5847,
    "high": 15.4787,
    "low": 14.5367,
    "close": 15.4727,
    "volume": 138853500.0
  },
  {
    "Unnamed: 0": 852,
    "time": 1396483200,
    "open": 15.5253,
    "high": 15.7153,
    "low": 14.8,
    "close": 15.0153,
    "volume": 140214000.0
  },
  {
    "Unnamed: 0": 853,
    "time": 1396569600,
    "open": 15.14,
    "high": 15.218,
    "low": 14.0493,
    "close": 14.0867,
    "volume": 146892000.0
  },
  {
    "Unnamed: 0": 854,
    "time": 1396828800,
    "open": 13.954,
    "high": 14.4133,
    "low": 13.5673,
    "close": 13.8593,
    "volume": 126373500.0
  },
  {
    "Unnamed: 0": 855,
    "time": 1396915200,
    "open": 13.9667,
    "high": 14.4327,
    "low": 13.708,
    "close": 14.3327,
    "volume": 87385500.0
  },
  {
    "Unnamed: 0": 856,
    "time": 1397001600,
    "open": 14.4667,
    "high": 14.5633,
    "low": 14.0593,
    "close": 14.5033,
    "volume": 65019000.0
  },
  {
    "Unnamed: 0": 857,
    "time": 1397088000,
    "open": 14.4747,
    "high": 14.5333,
    "low": 13.5067,
    "close": 13.546,
    "volume": 89880000.0
  },
  {
    "Unnamed: 0": 858,
    "time": 1397174400,
    "open": 13.546,
    "high": 13.8,
    "low": 13.24,
    "close": 13.6067,
    "volume": 115252500.0
  },
  {
    "Unnamed: 0": 859,
    "time": 1397433600,
    "open": 13.56,
    "high": 13.9667,
    "low": 12.9607,
    "close": 13.2233,
    "volume": 96993000.0
  },
  {
    "Unnamed: 0": 860,
    "time": 1397520000,
    "open": 13.2067,
    "high": 13.4,
    "low": 12.288,
    "close": 13.0127,
    "volume": 174859500.0
  },
  {
    "Unnamed: 0": 861,
    "time": 1397606400,
    "open": 13.182,
    "high": 13.3327,
    "low": 12.7213,
    "close": 13.1333,
    "volume": 87391500.0
  },
  {
    "Unnamed: 0": 862,
    "time": 1397692800,
    "open": 13.1667,
    "high": 13.486,
    "low": 12.9387,
    "close": 13.2,
    "volume": 75393000.0
  },
  {
    "Unnamed: 0": 863,
    "time": 1398038400,
    "open": 13.234,
    "high": 13.7467,
    "low": 12.9333,
    "close": 13.6933,
    "volume": 67105500.0
  },
  {
    "Unnamed: 0": 864,
    "time": 1398124800,
    "open": 13.7687,
    "high": 14.622,
    "low": 13.6067,
    "close": 14.5073,
    "volume": 123586500.0
  },
  {
    "Unnamed: 0": 865,
    "time": 1398211200,
    "open": 14.6,
    "high": 14.6653,
    "low": 13.8,
    "close": 14.04,
    "volume": 91764000.0
  },
  {
    "Unnamed: 0": 866,
    "time": 1398297600,
    "open": 14.0333,
    "high": 14.1867,
    "low": 13.5467,
    "close": 13.8333,
    "volume": 67018500.0
  },
  {
    "Unnamed: 0": 867,
    "time": 1398384000,
    "open": 13.8507,
    "high": 13.8867,
    "low": 13.1767,
    "close": 13.3027,
    "volume": 88900500.0
  },
  {
    "Unnamed: 0": 868,
    "time": 1398643200,
    "open": 13.2667,
    "high": 13.586,
    "low": 12.7,
    "close": 13.28,
    "volume": 90400500.0
  },
  {
    "Unnamed: 0": 869,
    "time": 1398729600,
    "open": 13.3387,
    "high": 13.81,
    "low": 13.0353,
    "close": 13.7,
    "volume": 74610000.0
  },
  {
    "Unnamed: 0": 870,
    "time": 1398816000,
    "open": 13.666,
    "high": 13.924,
    "low": 13.4187,
    "close": 13.9067,
    "volume": 55795500.0
  },
  {
    "Unnamed: 0": 871,
    "time": 1398902400,
    "open": 13.878,
    "high": 14.268,
    "low": 13.7127,
    "close": 13.8167,
    "volume": 68469000.0
  },
  {
    "Unnamed: 0": 872,
    "time": 1398988800,
    "open": 13.9727,
    "high": 14.1033,
    "low": 13.768,
    "close": 14.0867,
    "volume": 51756000.0
  },
  {
    "Unnamed: 0": 873,
    "time": 1399248000,
    "open": 14.1327,
    "high": 14.5127,
    "low": 13.8673,
    "close": 14.4467,
    "volume": 62872500.0
  },
  {
    "Unnamed: 0": 874,
    "time": 1399334400,
    "open": 14.5333,
    "high": 14.5773,
    "low": 13.7867,
    "close": 13.8173,
    "volume": 71347500.0
  },
  {
    "Unnamed: 0": 875,
    "time": 1399420800,
    "open": 13.8867,
    "high": 14.05,
    "low": 12.254,
    "close": 12.406,
    "volume": 127287000.0
  },
  {
    "Unnamed: 0": 876,
    "time": 1399507200,
    "open": 12.53,
    "high": 12.96,
    "low": 11.8147,
    "close": 11.8427,
    "volume": 257352000.0
  },
  {
    "Unnamed: 0": 877,
    "time": 1399593600,
    "open": 11.95,
    "high": 12.2267,
    "low": 11.8147,
    "close": 12.1333,
    "volume": 109512000.0
  },
  {
    "Unnamed: 0": 878,
    "time": 1399852800,
    "open": 12.1333,
    "high": 12.4793,
    "low": 11.992,
    "close": 12.332,
    "volume": 91471500.0
  },
  {
    "Unnamed: 0": 879,
    "time": 1399939200,
    "open": 12.3873,
    "high": 12.756,
    "low": 12.16,
    "close": 12.6793,
    "volume": 91531500.0
  },
  {
    "Unnamed: 0": 880,
    "time": 1400025600,
    "open": 12.7007,
    "high": 12.8987,
    "low": 12.4733,
    "close": 12.73,
    "volume": 70441500.0
  },
  {
    "Unnamed: 0": 881,
    "time": 1400112000,
    "open": 12.6207,
    "high": 12.844,
    "low": 12.3533,
    "close": 12.5787,
    "volume": 79266000.0
  },
  {
    "Unnamed: 0": 882,
    "time": 1400198400,
    "open": 12.5333,
    "high": 12.8027,
    "low": 12.474,
    "close": 12.77,
    "volume": 57685500.0
  },
  {
    "Unnamed: 0": 883,
    "time": 1400457600,
    "open": 12.7707,
    "high": 13.1333,
    "low": 12.6667,
    "close": 13.1333,
    "volume": 59709000.0
  },
  {
    "Unnamed: 0": 884,
    "time": 1400544000,
    "open": 13.08,
    "high": 13.2887,
    "low": 12.8713,
    "close": 12.9793,
    "volume": 72919500.0
  },
  {
    "Unnamed: 0": 885,
    "time": 1400630400,
    "open": 13.0,
    "high": 13.3333,
    "low": 12.986,
    "close": 13.326,
    "volume": 67347000.0
  },
  {
    "Unnamed: 0": 886,
    "time": 1400716800,
    "open": 13.348,
    "high": 13.792,
    "low": 13.3033,
    "close": 13.6507,
    "volume": 77029500.0
  },
  {
    "Unnamed: 0": 887,
    "time": 1400803200,
    "open": 13.6867,
    "high": 13.8507,
    "low": 13.5,
    "close": 13.826,
    "volume": 49992000.0
  },
  {
    "Unnamed: 0": 888,
    "time": 1401148800,
    "open": 13.9333,
    "high": 14.258,
    "low": 13.8,
    "close": 14.078,
    "volume": 68053500.0
  },
  {
    "Unnamed: 0": 889,
    "time": 1401235200,
    "open": 14.0387,
    "high": 14.1847,
    "low": 13.684,
    "close": 14.0,
    "volume": 68530500.0
  },
  {
    "Unnamed: 0": 890,
    "time": 1401321600,
    "open": 14.0133,
    "high": 14.166,
    "low": 13.848,
    "close": 14.0,
    "volume": 46740000.0
  },
  {
    "Unnamed: 0": 891,
    "time": 1401408000,
    "open": 14.0213,
    "high": 14.32,
    "low": 13.7833,
    "close": 13.8227,
    "volume": 72352500.0
  },
  {
    "Unnamed: 0": 892,
    "time": 1401667200,
    "open": 13.8213,
    "high": 13.9567,
    "low": 13.4447,
    "close": 13.5667,
    "volume": 59125500.0
  },
  {
    "Unnamed: 0": 893,
    "time": 1401753600,
    "open": 13.59,
    "high": 13.8667,
    "low": 13.506,
    "close": 13.64,
    "volume": 50698500.0
  },
  {
    "Unnamed: 0": 894,
    "time": 1401840000,
    "open": 13.6473,
    "high": 13.7507,
    "low": 13.36,
    "close": 13.5433,
    "volume": 44190000.0
  },
  {
    "Unnamed: 0": 895,
    "time": 1401926400,
    "open": 13.5827,
    "high": 13.9467,
    "low": 13.5507,
    "close": 13.8,
    "volume": 50929500.0
  },
  {
    "Unnamed: 0": 896,
    "time": 1402012800,
    "open": 13.9267,
    "high": 14.054,
    "low": 13.812,
    "close": 13.858,
    "volume": 39301500.0
  },
  {
    "Unnamed: 0": 897,
    "time": 1402272000,
    "open": 13.8993,
    "high": 13.9993,
    "low": 13.5867,
    "close": 13.602,
    "volume": 34545000.0
  },
  {
    "Unnamed: 0": 898,
    "time": 1402358400,
    "open": 13.5853,
    "high": 13.798,
    "low": 13.4367,
    "close": 13.484,
    "volume": 43896000.0
  },
  {
    "Unnamed: 0": 899,
    "time": 1402444800,
    "open": 13.44,
    "high": 13.6667,
    "low": 13.2833,
    "close": 13.6333,
    "volume": 52020000.0
  },
  {
    "Unnamed: 0": 900,
    "time": 1402531200,
    "open": 13.6493,
    "high": 13.992,
    "low": 13.514,
    "close": 13.5627,
    "volume": 78660000.0
  },
  {
    "Unnamed: 0": 901,
    "time": 1402617600,
    "open": 13.596,
    "high": 13.816,
    "low": 13.4387,
    "close": 13.7227,
    "volume": 91671000.0
  },
  {
    "Unnamed: 0": 902,
    "time": 1402876800,
    "open": 13.8,
    "high": 15.0327,
    "low": 13.694,
    "close": 15.0,
    "volume": 171028500.0
  },
  {
    "Unnamed: 0": 903,
    "time": 1402963200,
    "open": 14.9767,
    "high": 15.7027,
    "low": 14.8567,
    "close": 15.3667,
    "volume": 169213500.0
  },
  {
    "Unnamed: 0": 904,
    "time": 1403049600,
    "open": 15.3713,
    "high": 15.4993,
    "low": 15.0747,
    "close": 15.12,
    "volume": 89343000.0
  },
  {
    "Unnamed: 0": 905,
    "time": 1403136000,
    "open": 15.1547,
    "high": 15.6873,
    "low": 15.0667,
    "close": 15.0687,
    "volume": 114487500.0
  },
  {
    "Unnamed: 0": 906,
    "time": 1403222400,
    "open": 15.202,
    "high": 15.4193,
    "low": 15.08,
    "close": 15.2667,
    "volume": 63924000.0
  },
  {
    "Unnamed: 0": 907,
    "time": 1403481600,
    "open": 15.264,
    "high": 15.9327,
    "low": 15.2147,
    "close": 15.846,
    "volume": 100888500.0
  },
  {
    "Unnamed: 0": 908,
    "time": 1403568000,
    "open": 15.82,
    "high": 16.1253,
    "low": 15.442,
    "close": 15.5133,
    "volume": 104314500.0
  },
  {
    "Unnamed: 0": 909,
    "time": 1403654400,
    "open": 15.472,
    "high": 15.8367,
    "low": 15.3493,
    "close": 15.7833,
    "volume": 74611500.0
  },
  {
    "Unnamed: 0": 910,
    "time": 1403740800,
    "open": 15.7853,
    "high": 16.0267,
    "low": 15.614,
    "close": 15.6733,
    "volume": 65886000.0
  },
  {
    "Unnamed: 0": 911,
    "time": 1403827200,
    "open": 15.6667,
    "high": 16.0,
    "low": 15.5667,
    "close": 15.9573,
    "volume": 75367500.0
  },
  {
    "Unnamed: 0": 912,
    "time": 1404086400,
    "open": 15.868,
    "high": 16.2993,
    "low": 15.868,
    "close": 16.0233,
    "volume": 61995000.0
  },
  {
    "Unnamed: 0": 913,
    "time": 1404172800,
    "open": 16.066,
    "high": 16.2293,
    "low": 15.9133,
    "close": 15.9633,
    "volume": 53196000.0
  },
  {
    "Unnamed: 0": 914,
    "time": 1404259200,
    "open": 15.9667,
    "high": 16.1553,
    "low": 15.138,
    "close": 15.32,
    "volume": 102298500.0
  },
  {
    "Unnamed: 0": 915,
    "time": 1404345600,
    "open": 15.3333,
    "high": 15.5933,
    "low": 14.9333,
    "close": 15.2327,
    "volume": 66034500.0
  },
  {
    "Unnamed: 0": 916,
    "time": 1404691200,
    "open": 15.2113,
    "high": 15.3333,
    "low": 14.6933,
    "close": 14.7833,
    "volume": 74419500.0
  },
  {
    "Unnamed: 0": 917,
    "time": 1404777600,
    "open": 14.8667,
    "high": 14.8667,
    "low": 14.2847,
    "close": 14.598,
    "volume": 101098500.0
  },
  {
    "Unnamed: 0": 918,
    "time": 1404864000,
    "open": 14.6107,
    "high": 14.948,
    "low": 14.5993,
    "close": 14.8667,
    "volume": 50980500.0
  },
  {
    "Unnamed: 0": 919,
    "time": 1404950400,
    "open": 14.8347,
    "high": 14.8667,
    "low": 14.4027,
    "close": 14.62,
    "volume": 63258000.0
  },
  {
    "Unnamed: 0": 920,
    "time": 1405036800,
    "open": 14.6587,
    "high": 14.7927,
    "low": 14.4667,
    "close": 14.502,
    "volume": 41347500.0
  },
  {
    "Unnamed: 0": 921,
    "time": 1405296000,
    "open": 14.6827,
    "high": 15.2527,
    "low": 14.3633,
    "close": 15.1333,
    "volume": 92257500.0
  },
  {
    "Unnamed: 0": 922,
    "time": 1405382400,
    "open": 15.1707,
    "high": 15.2,
    "low": 14.54,
    "close": 14.62,
    "volume": 71305500.0
  },
  {
    "Unnamed: 0": 923,
    "time": 1405468800,
    "open": 14.6533,
    "high": 14.9867,
    "low": 14.4273,
    "close": 14.4387,
    "volume": 51513000.0
  },
  {
    "Unnamed: 0": 924,
    "time": 1405555200,
    "open": 14.4467,
    "high": 14.7033,
    "low": 14.2333,
    "close": 14.3247,
    "volume": 57648000.0
  },
  {
    "Unnamed: 0": 925,
    "time": 1405641600,
    "open": 14.35,
    "high": 14.7473,
    "low": 14.3333,
    "close": 14.68,
    "volume": 53826000.0
  },
  {
    "Unnamed: 0": 926,
    "time": 1405900800,
    "open": 14.6813,
    "high": 14.8807,
    "low": 14.448,
    "close": 14.6993,
    "volume": 49165500.0
  },
  {
    "Unnamed: 0": 927,
    "time": 1405987200,
    "open": 14.836,
    "high": 14.8867,
    "low": 14.6073,
    "close": 14.6407,
    "volume": 35058000.0
  },
  {
    "Unnamed: 0": 928,
    "time": 1406073600,
    "open": 14.628,
    "high": 14.9833,
    "low": 14.628,
    "close": 14.906,
    "volume": 39615000.0
  },
  {
    "Unnamed: 0": 929,
    "time": 1406160000,
    "open": 14.9053,
    "high": 15.0067,
    "low": 14.72,
    "close": 14.8347,
    "volume": 39552000.0
  },
  {
    "Unnamed: 0": 930,
    "time": 1406246400,
    "open": 14.824,
    "high": 15.1313,
    "low": 14.77,
    "close": 14.914,
    "volume": 39411000.0
  },
  {
    "Unnamed: 0": 931,
    "time": 1406505600,
    "open": 14.894,
    "high": 15.4667,
    "low": 14.76,
    "close": 14.9767,
    "volume": 84943500.0
  },
  {
    "Unnamed: 0": 932,
    "time": 1406592000,
    "open": 15.024,
    "high": 15.22,
    "low": 14.944,
    "close": 15.0533,
    "volume": 41269500.0
  },
  {
    "Unnamed: 0": 933,
    "time": 1406678400,
    "open": 15.0333,
    "high": 15.3067,
    "low": 14.6833,
    "close": 15.2867,
    "volume": 60807000.0
  },
  {
    "Unnamed: 0": 934,
    "time": 1406764800,
    "open": 15.3573,
    "high": 15.4713,
    "low": 13.9147,
    "close": 14.8727,
    "volume": 96696000.0
  },
  {
    "Unnamed: 0": 935,
    "time": 1406851200,
    "open": 14.8333,
    "high": 15.8333,
    "low": 14.388,
    "close": 15.54,
    "volume": 153400500.0
  },
  {
    "Unnamed: 0": 936,
    "time": 1407110400,
    "open": 15.6653,
    "high": 16.0333,
    "low": 15.4667,
    "close": 15.8867,
    "volume": 75952500.0
  },
  {
    "Unnamed: 0": 937,
    "time": 1407196800,
    "open": 15.9087,
    "high": 16.1993,
    "low": 15.7127,
    "close": 15.9287,
    "volume": 67884000.0
  },
  {
    "Unnamed: 0": 938,
    "time": 1407283200,
    "open": 15.9467,
    "high": 16.7613,
    "low": 15.8167,
    "close": 16.536,
    "volume": 118677000.0
  },
  {
    "Unnamed: 0": 939,
    "time": 1407369600,
    "open": 16.5667,
    "high": 17.1127,
    "low": 16.5067,
    "close": 16.8033,
    "volume": 95010000.0
  },
  {
    "Unnamed: 0": 940,
    "time": 1407456000,
    "open": 16.752,
    "high": 16.826,
    "low": 16.4333,
    "close": 16.5473,
    "volume": 64384500.0
  },
  {
    "Unnamed: 0": 941,
    "time": 1407715200,
    "open": 16.8327,
    "high": 17.5827,
    "low": 16.5333,
    "close": 17.2627,
    "volume": 101056500.0
  },
  {
    "Unnamed: 0": 942,
    "time": 1407801600,
    "open": 17.3587,
    "high": 17.3813,
    "low": 16.972,
    "close": 17.3333,
    "volume": 74634000.0
  },
  {
    "Unnamed: 0": 943,
    "time": 1407888000,
    "open": 17.39,
    "high": 17.7093,
    "low": 17.3073,
    "close": 17.532,
    "volume": 88335000.0
  },
  {
    "Unnamed: 0": 944,
    "time": 1407974400,
    "open": 17.5867,
    "high": 17.5927,
    "low": 17.236,
    "close": 17.41,
    "volume": 51877500.0
  },
  {
    "Unnamed: 0": 945,
    "time": 1408060800,
    "open": 17.4953,
    "high": 17.5193,
    "low": 17.2333,
    "close": 17.4667,
    "volume": 47685000.0
  },
  {
    "Unnamed: 0": 946,
    "time": 1408320000,
    "open": 17.5333,
    "high": 17.8173,
    "low": 17.2833,
    "close": 17.2833,
    "volume": 71943000.0
  },
  {
    "Unnamed: 0": 947,
    "time": 1408406400,
    "open": 17.3313,
    "high": 17.4,
    "low": 16.7747,
    "close": 17.0787,
    "volume": 66840000.0
  },
  {
    "Unnamed: 0": 948,
    "time": 1408492800,
    "open": 17.0153,
    "high": 17.2493,
    "low": 16.8667,
    "close": 17.0167,
    "volume": 38166000.0
  },
  {
    "Unnamed: 0": 949,
    "time": 1408579200,
    "open": 17.0667,
    "high": 17.2533,
    "low": 16.884,
    "close": 16.96,
    "volume": 37018500.0
  },
  {
    "Unnamed: 0": 950,
    "time": 1408665600,
    "open": 16.9267,
    "high": 17.1413,
    "low": 16.8407,
    "close": 17.116,
    "volume": 35620500.0
  },
  {
    "Unnamed: 0": 951,
    "time": 1408924800,
    "open": 17.2,
    "high": 17.5787,
    "low": 17.1333,
    "close": 17.51,
    "volume": 55287000.0
  },
  {
    "Unnamed: 0": 952,
    "time": 1409011200,
    "open": 17.5333,
    "high": 17.706,
    "low": 17.44,
    "close": 17.468,
    "volume": 47110500.0
  },
  {
    "Unnamed: 0": 953,
    "time": 1409097600,
    "open": 17.5,
    "high": 17.616,
    "low": 17.3527,
    "close": 17.55,
    "volume": 38287500.0
  },
  {
    "Unnamed: 0": 954,
    "time": 1409184000,
    "open": 17.4273,
    "high": 17.632,
    "low": 17.41,
    "close": 17.606,
    "volume": 36576000.0
  },
  {
    "Unnamed: 0": 955,
    "time": 1409270400,
    "open": 17.666,
    "high": 18.1333,
    "low": 17.666,
    "close": 17.9833,
    "volume": 82822500.0
  },
  {
    "Unnamed: 0": 956,
    "time": 1409616000,
    "open": 18.0067,
    "high": 18.9927,
    "low": 18.0067,
    "close": 18.9733,
    "volume": 122932500.0
  },
  {
    "Unnamed: 0": 957,
    "time": 1409702400,
    "open": 18.9967,
    "high": 19.2513,
    "low": 18.6733,
    "close": 18.7067,
    "volume": 83658000.0
  },
  {
    "Unnamed: 0": 958,
    "time": 1409788800,
    "open": 18.8133,
    "high": 19.428,
    "low": 18.62,
    "close": 19.1133,
    "volume": 104331000.0
  },
  {
    "Unnamed: 0": 959,
    "time": 1409875200,
    "open": 19.198,
    "high": 19.2607,
    "low": 18.1673,
    "close": 18.442,
    "volume": 136144500.0
  },
  {
    "Unnamed: 0": 960,
    "time": 1410134400,
    "open": 18.5433,
    "high": 18.992,
    "low": 18.4927,
    "close": 18.8,
    "volume": 69922500.0
  },
  {
    "Unnamed: 0": 961,
    "time": 1410220800,
    "open": 18.8313,
    "high": 19.0327,
    "low": 18.4667,
    "close": 18.5933,
    "volume": 57493500.0
  },
  {
    "Unnamed: 0": 962,
    "time": 1410307200,
    "open": 18.6,
    "high": 18.7647,
    "low": 18.244,
    "close": 18.7533,
    "volume": 46741500.0
  },
  {
    "Unnamed: 0": 963,
    "time": 1410393600,
    "open": 18.8,
    "high": 18.986,
    "low": 18.5753,
    "close": 18.6767,
    "volume": 48127500.0
  },
  {
    "Unnamed: 0": 964,
    "time": 1410480000,
    "open": 18.7193,
    "high": 18.826,
    "low": 18.4667,
    "close": 18.59,
    "volume": 41457000.0
  },
  {
    "Unnamed: 0": 965,
    "time": 1410739200,
    "open": 18.5413,
    "high": 18.5413,
    "low": 16.6087,
    "close": 17.0,
    "volume": 209746500.0
  },
  {
    "Unnamed: 0": 966,
    "time": 1410825600,
    "open": 17.1153,
    "high": 17.4973,
    "low": 16.828,
    "close": 17.38,
    "volume": 106606500.0
  },
  {
    "Unnamed: 0": 967,
    "time": 1410912000,
    "open": 17.4967,
    "high": 17.6467,
    "low": 17.3,
    "close": 17.434,
    "volume": 65944500.0
  },
  {
    "Unnamed: 0": 968,
    "time": 1410998400,
    "open": 17.5413,
    "high": 17.7067,
    "low": 17.4253,
    "close": 17.55,
    "volume": 47353500.0
  },
  {
    "Unnamed: 0": 969,
    "time": 1411084800,
    "open": 17.6,
    "high": 17.6333,
    "low": 17.0087,
    "close": 17.2307,
    "volume": 87552000.0
  },
  {
    "Unnamed: 0": 970,
    "time": 1411344000,
    "open": 17.2187,
    "high": 17.3133,
    "low": 16.314,
    "close": 16.5333,
    "volume": 104559000.0
  },
  {
    "Unnamed: 0": 971,
    "time": 1411430400,
    "open": 16.4327,
    "high": 16.92,
    "low": 16.2333,
    "close": 16.66,
    "volume": 73747500.0
  },
  {
    "Unnamed: 0": 972,
    "time": 1411516800,
    "open": 16.63,
    "high": 16.856,
    "low": 16.4693,
    "close": 16.7967,
    "volume": 48142500.0
  },
  {
    "Unnamed: 0": 973,
    "time": 1411603200,
    "open": 16.918,
    "high": 16.9973,
    "low": 16.4067,
    "close": 16.48,
    "volume": 61905000.0
  },
  {
    "Unnamed: 0": 974,
    "time": 1411689600,
    "open": 16.4707,
    "high": 16.6487,
    "low": 16.4047,
    "close": 16.4367,
    "volume": 49257000.0
  },
  {
    "Unnamed: 0": 975,
    "time": 1411948800,
    "open": 16.3587,
    "high": 16.576,
    "low": 16.0467,
    "close": 16.3133,
    "volume": 61668000.0
  },
  {
    "Unnamed: 0": 976,
    "time": 1412035200,
    "open": 16.3673,
    "high": 16.51,
    "low": 16.008,
    "close": 16.1933,
    "volume": 54453000.0
  },
  {
    "Unnamed: 0": 977,
    "time": 1412121600,
    "open": 16.1667,
    "high": 16.2333,
    "low": 15.71,
    "close": 16.0573,
    "volume": 75615000.0
  },
  {
    "Unnamed: 0": 978,
    "time": 1412208000,
    "open": 16.0973,
    "high": 16.9867,
    "low": 16.0413,
    "close": 16.724,
    "volume": 118692000.0
  },
  {
    "Unnamed: 0": 979,
    "time": 1412294400,
    "open": 16.8667,
    "high": 17.1,
    "low": 16.7353,
    "close": 17.0667,
    "volume": 70530000.0
  },
  {
    "Unnamed: 0": 980,
    "time": 1412553600,
    "open": 17.0767,
    "high": 17.4993,
    "low": 17.014,
    "close": 17.35,
    "volume": 102403500.0
  },
  {
    "Unnamed: 0": 981,
    "time": 1412640000,
    "open": 17.3547,
    "high": 17.4307,
    "low": 17.0487,
    "close": 17.3267,
    "volume": 59218500.0
  },
  {
    "Unnamed: 0": 982,
    "time": 1412726400,
    "open": 17.3267,
    "high": 17.5253,
    "low": 16.8427,
    "close": 17.352,
    "volume": 63711000.0
  },
  {
    "Unnamed: 0": 983,
    "time": 1412812800,
    "open": 17.466,
    "high": 17.7027,
    "low": 16.96,
    "close": 17.2373,
    "volume": 94407000.0
  },
  {
    "Unnamed: 0": 984,
    "time": 1412899200,
    "open": 16.7993,
    "high": 16.8667,
    "low": 15.68,
    "close": 15.8133,
    "volume": 167515500.0
  },
  {
    "Unnamed: 0": 985,
    "time": 1413158400,
    "open": 15.8067,
    "high": 16.0193,
    "low": 14.6667,
    "close": 14.87,
    "volume": 145405500.0
  },
  {
    "Unnamed: 0": 986,
    "time": 1413244800,
    "open": 15.0,
    "high": 15.498,
    "low": 14.8667,
    "close": 15.2493,
    "volume": 89052000.0
  },
  {
    "Unnamed: 0": 987,
    "time": 1413331200,
    "open": 15.2013,
    "high": 15.3993,
    "low": 14.488,
    "close": 14.8993,
    "volume": 116542500.0
  },
  {
    "Unnamed: 0": 988,
    "time": 1413417600,
    "open": 14.8667,
    "high": 15.328,
    "low": 14.5,
    "close": 15.1053,
    "volume": 66036000.0
  },
  {
    "Unnamed: 0": 989,
    "time": 1413504000,
    "open": 15.286,
    "high": 15.6513,
    "low": 15.09,
    "close": 15.1633,
    "volume": 146335500.0
  },
  {
    "Unnamed: 0": 990,
    "time": 1413763200,
    "open": 15.2693,
    "high": 15.4933,
    "low": 14.8747,
    "close": 15.388,
    "volume": 43081500.0
  },
  {
    "Unnamed: 0": 991,
    "time": 1413849600,
    "open": 15.4667,
    "high": 15.7167,
    "low": 15.226,
    "close": 15.6333,
    "volume": 49818000.0
  },
  {
    "Unnamed: 0": 992,
    "time": 1413936000,
    "open": 15.6107,
    "high": 15.826,
    "low": 15.3707,
    "close": 15.4567,
    "volume": 50922000.0
  },
  {
    "Unnamed: 0": 993,
    "time": 1414022400,
    "open": 15.554,
    "high": 15.752,
    "low": 15.4067,
    "close": 15.69,
    "volume": 44418000.0
  },
  {
    "Unnamed: 0": 994,
    "time": 1414108800,
    "open": 15.6573,
    "high": 15.8533,
    "low": 15.4133,
    "close": 15.7067,
    "volume": 44964000.0
  },
  {
    "Unnamed: 0": 995,
    "time": 1414368000,
    "open": 15.7107,
    "high": 15.7333,
    "low": 14.6873,
    "close": 14.792,
    "volume": 122512500.0
  },
  {
    "Unnamed: 0": 996,
    "time": 1414454400,
    "open": 14.9333,
    "high": 16.3067,
    "low": 14.9333,
    "close": 16.0307,
    "volume": 136755000.0
  },
  {
    "Unnamed: 0": 997,
    "time": 1414540800,
    "open": 16.1653,
    "high": 16.2667,
    "low": 15.7093,
    "close": 15.8607,
    "volume": 64392000.0
  },
  {
    "Unnamed: 0": 998,
    "time": 1414627200,
    "open": 15.8667,
    "high": 16.0333,
    "low": 15.6407,
    "close": 15.9107,
    "volume": 41557500.0
  },
  {
    "Unnamed: 0": 999,
    "time": 1414713600,
    "open": 16.1267,
    "high": 16.2333,
    "low": 15.9167,
    "close": 16.1127,
    "volume": 95433000.0
  },
  {
    "Unnamed: 0": 1000,
    "time": 1414972800,
    "open": 16.1533,
    "high": 16.504,
    "low": 16.088,
    "close": 16.152,
    "volume": 53284500.0
  },
  {
    "Unnamed: 0": 1001,
    "time": 1415059200,
    "open": 16.2013,
    "high": 16.2267,
    "low": 15.7687,
    "close": 15.9993,
    "volume": 45828000.0
  },
  {
    "Unnamed: 0": 1002,
    "time": 1415145600,
    "open": 16.0967,
    "high": 16.6267,
    "low": 14.4667,
    "close": 16.46,
    "volume": 110295000.0
  },
  {
    "Unnamed: 0": 1003,
    "time": 1415232000,
    "open": 16.4,
    "high": 16.446,
    "low": 15.2333,
    "close": 16.12,
    "volume": 199843500.0
  },
  {
    "Unnamed: 0": 1004,
    "time": 1415318400,
    "open": 16.332,
    "high": 16.332,
    "low": 15.8133,
    "close": 15.9907,
    "volume": 66370500.0
  },
  {
    "Unnamed: 0": 1005,
    "time": 1415577600,
    "open": 16.036,
    "high": 16.192,
    "low": 15.7867,
    "close": 16.152,
    "volume": 60531000.0
  },
  {
    "Unnamed: 0": 1006,
    "time": 1415664000,
    "open": 16.1347,
    "high": 16.788,
    "low": 16.0973,
    "close": 16.74,
    "volume": 104346000.0
  },
  {
    "Unnamed: 0": 1007,
    "time": 1415750400,
    "open": 16.7467,
    "high": 16.8227,
    "low": 16.372,
    "close": 16.6593,
    "volume": 74176500.0
  },
  {
    "Unnamed: 0": 1008,
    "time": 1415836800,
    "open": 16.6767,
    "high": 17.05,
    "low": 16.6067,
    "close": 16.8,
    "volume": 83121000.0
  },
  {
    "Unnamed: 0": 1009,
    "time": 1415923200,
    "open": 16.7813,
    "high": 17.2567,
    "low": 16.4467,
    "close": 17.2233,
    "volume": 80746500.0
  },
  {
    "Unnamed: 0": 1010,
    "time": 1416182400,
    "open": 17.1833,
    "high": 17.2667,
    "low": 16.8013,
    "close": 16.93,
    "volume": 106527000.0
  },
  {
    "Unnamed: 0": 1011,
    "time": 1416268800,
    "open": 16.9573,
    "high": 17.3327,
    "low": 16.8667,
    "close": 17.1733,
    "volume": 59107500.0
  },
  {
    "Unnamed: 0": 1012,
    "time": 1416355200,
    "open": 17.1833,
    "high": 17.1973,
    "low": 16.3733,
    "close": 16.5687,
    "volume": 102915000.0
  },
  {
    "Unnamed: 0": 1013,
    "time": 1416441600,
    "open": 16.4367,
    "high": 16.7287,
    "low": 16.4,
    "close": 16.6327,
    "volume": 46186500.0
  },
  {
    "Unnamed: 0": 1014,
    "time": 1416528000,
    "open": 16.656,
    "high": 16.8667,
    "low": 16.12,
    "close": 16.1513,
    "volume": 98868000.0
  },
  {
    "Unnamed: 0": 1015,
    "time": 1416787200,
    "open": 16.3153,
    "high": 16.5567,
    "low": 16.0427,
    "close": 16.4253,
    "volume": 62733000.0
  },
  {
    "Unnamed: 0": 1016,
    "time": 1416873600,
    "open": 16.5053,
    "high": 16.648,
    "low": 16.4,
    "close": 16.566,
    "volume": 41280000.0
  },
  {
    "Unnamed: 0": 1017,
    "time": 1416960000,
    "open": 16.582,
    "high": 16.6,
    "low": 16.44,
    "close": 16.592,
    "volume": 25401000.0
  },
  {
    "Unnamed: 0": 1018,
    "time": 1417132800,
    "open": 16.486,
    "high": 16.6433,
    "low": 16.168,
    "close": 16.2733,
    "volume": 26473500.0
  },
  {
    "Unnamed: 0": 1019,
    "time": 1417392000,
    "open": 16.162,
    "high": 16.3647,
    "low": 15.2673,
    "close": 15.4993,
    "volume": 111850500.0
  },
  {
    "Unnamed: 0": 1020,
    "time": 1417478400,
    "open": 15.5733,
    "high": 15.8127,
    "low": 15.2,
    "close": 15.4653,
    "volume": 77887500.0
  },
  {
    "Unnamed: 0": 1021,
    "time": 1417564800,
    "open": 15.4933,
    "high": 15.512,
    "low": 15.0333,
    "close": 15.3327,
    "volume": 68868000.0
  },
  {
    "Unnamed: 0": 1022,
    "time": 1417651200,
    "open": 15.3327,
    "high": 15.5033,
    "low": 15.154,
    "close": 15.1913,
    "volume": 50370000.0
  },
  {
    "Unnamed: 0": 1023,
    "time": 1417737600,
    "open": 15.234,
    "high": 15.3653,
    "low": 14.7893,
    "close": 14.9667,
    "volume": 79653000.0
  },
  {
    "Unnamed: 0": 1024,
    "time": 1417996800,
    "open": 14.9193,
    "high": 14.9907,
    "low": 14.1333,
    "close": 14.3193,
    "volume": 121050000.0
  },
  {
    "Unnamed: 0": 1025,
    "time": 1418083200,
    "open": 14.1333,
    "high": 14.5153,
    "low": 13.618,
    "close": 14.4167,
    "volume": 124179000.0
  },
  {
    "Unnamed: 0": 1026,
    "time": 1418169600,
    "open": 14.4833,
    "high": 14.5233,
    "low": 13.8467,
    "close": 13.9407,
    "volume": 96352500.0
  },
  {
    "Unnamed: 0": 1027,
    "time": 1418256000,
    "open": 13.9833,
    "high": 14.362,
    "low": 13.8193,
    "close": 13.8667,
    "volume": 86691000.0
  },
  {
    "Unnamed: 0": 1028,
    "time": 1418342400,
    "open": 13.8387,
    "high": 14.112,
    "low": 13.602,
    "close": 13.86,
    "volume": 93274500.0
  },
  {
    "Unnamed: 0": 1029,
    "time": 1418601600,
    "open": 14.05,
    "high": 14.05,
    "low": 13.5113,
    "close": 13.5667,
    "volume": 67555500.0
  },
  {
    "Unnamed: 0": 1030,
    "time": 1418688000,
    "open": 13.6,
    "high": 13.6,
    "low": 13.0247,
    "close": 13.1667,
    "volume": 109290000.0
  },
  {
    "Unnamed: 0": 1031,
    "time": 1418774400,
    "open": 13.1873,
    "high": 13.7793,
    "low": 12.8333,
    "close": 13.77,
    "volume": 95917500.0
  },
  {
    "Unnamed: 0": 1032,
    "time": 1418860800,
    "open": 13.9627,
    "high": 14.5913,
    "low": 13.9627,
    "close": 14.5507,
    "volume": 95482500.0
  },
  {
    "Unnamed: 0": 1033,
    "time": 1418947200,
    "open": 14.7273,
    "high": 14.8113,
    "low": 14.3,
    "close": 14.6127,
    "volume": 91818000.0
  },
  {
    "Unnamed: 0": 1034,
    "time": 1419206400,
    "open": 14.6667,
    "high": 14.9373,
    "low": 14.5507,
    "close": 14.8367,
    "volume": 63783000.0
  },
  {
    "Unnamed: 0": 1035,
    "time": 1419292800,
    "open": 14.8653,
    "high": 14.9667,
    "low": 14.6347,
    "close": 14.7,
    "volume": 58047000.0
  },
  {
    "Unnamed: 0": 1036,
    "time": 1419379200,
    "open": 14.7313,
    "high": 14.8333,
    "low": 14.6167,
    "close": 14.8307,
    "volume": 17316000.0
  },
  {
    "Unnamed: 0": 1037,
    "time": 1419552000,
    "open": 14.8267,
    "high": 15.2333,
    "low": 14.7647,
    "close": 15.1893,
    "volume": 43195500.0
  },
  {
    "Unnamed: 0": 1038,
    "time": 1419811200,
    "open": 15.1433,
    "high": 15.194,
    "low": 14.9347,
    "close": 15.046,
    "volume": 35398500.0
  },
  {
    "Unnamed: 0": 1039,
    "time": 1419897600,
    "open": 14.9247,
    "high": 15.0667,
    "low": 14.76,
    "close": 14.838,
    "volume": 38286000.0
  },
  {
    "Unnamed: 0": 1040,
    "time": 1419984000,
    "open": 14.838,
    "high": 15.0453,
    "low": 14.8153,
    "close": 14.8267,
    "volume": 30895500.0
  },
  {
    "Unnamed: 0": 1041,
    "time": 1420156800,
    "open": 14.886,
    "high": 14.9333,
    "low": 14.2173,
    "close": 14.62,
    "volume": 60666000.0
  },
  {
    "Unnamed: 0": 1042,
    "time": 1420416000,
    "open": 14.57,
    "high": 14.57,
    "low": 13.8107,
    "close": 13.908,
    "volume": 68766000.0
  },
  {
    "Unnamed: 0": 1043,
    "time": 1420502400,
    "open": 13.9333,
    "high": 14.28,
    "low": 13.614,
    "close": 14.0933,
    "volume": 81739500.0
  },
  {
    "Unnamed: 0": 1044,
    "time": 1420588800,
    "open": 14.1867,
    "high": 14.3187,
    "low": 13.9853,
    "close": 14.0733,
    "volume": 38506500.0
  },
  {
    "Unnamed: 0": 1045,
    "time": 1420675200,
    "open": 14.1613,
    "high": 14.3213,
    "low": 14.0007,
    "close": 14.0633,
    "volume": 43804500.0
  },
  {
    "Unnamed: 0": 1046,
    "time": 1420761600,
    "open": 13.8607,
    "high": 14.0533,
    "low": 13.664,
    "close": 13.75,
    "volume": 60375000.0
  },
  {
    "Unnamed: 0": 1047,
    "time": 1421020800,
    "open": 13.7047,
    "high": 13.7047,
    "low": 13.2833,
    "close": 13.4873,
    "volume": 77257500.0
  },
  {
    "Unnamed: 0": 1048,
    "time": 1421107200,
    "open": 13.4267,
    "high": 13.8407,
    "low": 12.5333,
    "close": 12.7967,
    "volume": 56380500.0
  },
  {
    "Unnamed: 0": 1049,
    "time": 1421193600,
    "open": 12.8013,
    "high": 13.0133,
    "low": 12.2333,
    "close": 12.8533,
    "volume": 149176500.0
  },
  {
    "Unnamed: 0": 1050,
    "time": 1421280000,
    "open": 12.936,
    "high": 13.05,
    "low": 12.6367,
    "close": 12.74,
    "volume": 68364000.0
  },
  {
    "Unnamed: 0": 1051,
    "time": 1421366400,
    "open": 12.7047,
    "high": 12.966,
    "low": 12.3367,
    "close": 12.8953,
    "volume": 46059000.0
  },
  {
    "Unnamed: 0": 1052,
    "time": 1421712000,
    "open": 12.89,
    "high": 13.0193,
    "low": 12.4693,
    "close": 12.84,
    "volume": 57217500.0
  },
  {
    "Unnamed: 0": 1053,
    "time": 1421798400,
    "open": 12.652,
    "high": 13.2453,
    "low": 12.3333,
    "close": 13.104,
    "volume": 54037500.0
  },
  {
    "Unnamed: 0": 1054,
    "time": 1421884800,
    "open": 13.2387,
    "high": 13.5493,
    "low": 13.0133,
    "close": 13.5167,
    "volume": 53611500.0
  },
  {
    "Unnamed: 0": 1055,
    "time": 1421971200,
    "open": 13.4833,
    "high": 13.5667,
    "low": 13.222,
    "close": 13.4093,
    "volume": 43978500.0
  },
  {
    "Unnamed: 0": 1056,
    "time": 1422230400,
    "open": 13.3913,
    "high": 13.908,
    "low": 13.3667,
    "close": 13.782,
    "volume": 41752500.0
  },
  {
    "Unnamed: 0": 1057,
    "time": 1422316800,
    "open": 13.8,
    "high": 13.8687,
    "low": 13.48,
    "close": 13.7933,
    "volume": 35581500.0
  },
  {
    "Unnamed: 0": 1058,
    "time": 1422403200,
    "open": 13.8253,
    "high": 13.8633,
    "low": 13.228,
    "close": 13.3333,
    "volume": 40210500.0
  },
  {
    "Unnamed: 0": 1059,
    "time": 1422489600,
    "open": 13.2673,
    "high": 13.732,
    "low": 13.1,
    "close": 13.6907,
    "volume": 42373500.0
  },
  {
    "Unnamed: 0": 1060,
    "time": 1422576000,
    "open": 13.7333,
    "high": 13.8313,
    "low": 13.5333,
    "close": 13.5667,
    "volume": 39295500.0
  },
  {
    "Unnamed: 0": 1061,
    "time": 1422835200,
    "open": 13.574,
    "high": 14.13,
    "low": 13.5533,
    "close": 14.0007,
    "volume": 54160500.0
  },
  {
    "Unnamed: 0": 1062,
    "time": 1422921600,
    "open": 14.2,
    "high": 14.6913,
    "low": 14.0333,
    "close": 14.5733,
    "volume": 62689500.0
  },
  {
    "Unnamed: 0": 1063,
    "time": 1423008000,
    "open": 14.4907,
    "high": 14.7653,
    "low": 14.4533,
    "close": 14.5167,
    "volume": 40846500.0
  },
  {
    "Unnamed: 0": 1064,
    "time": 1423094400,
    "open": 14.5853,
    "high": 15.032,
    "low": 14.57,
    "close": 14.73,
    "volume": 45030000.0
  },
  {
    "Unnamed: 0": 1065,
    "time": 1423180800,
    "open": 14.6673,
    "high": 14.8933,
    "low": 14.4333,
    "close": 14.45,
    "volume": 41568000.0
  },
  {
    "Unnamed: 0": 1066,
    "time": 1423440000,
    "open": 14.4333,
    "high": 14.5533,
    "low": 14.1327,
    "close": 14.5007,
    "volume": 45162000.0
  },
  {
    "Unnamed: 0": 1067,
    "time": 1423526400,
    "open": 14.4747,
    "high": 14.7,
    "low": 14.268,
    "close": 14.32,
    "volume": 70638000.0
  },
  {
    "Unnamed: 0": 1068,
    "time": 1423612800,
    "open": 14.3267,
    "high": 14.5227,
    "low": 13.4,
    "close": 13.6333,
    "volume": 122290500.0
  },
  {
    "Unnamed: 0": 1069,
    "time": 1423699200,
    "open": 13.6327,
    "high": 13.6327,
    "low": 12.8747,
    "close": 13.5233,
    "volume": 202587000.0
  },
  {
    "Unnamed: 0": 1070,
    "time": 1423785600,
    "open": 13.6667,
    "high": 13.7327,
    "low": 13.394,
    "close": 13.5213,
    "volume": 77947500.0
  },
  {
    "Unnamed: 0": 1071,
    "time": 1424131200,
    "open": 13.7333,
    "high": 13.8087,
    "low": 13.4333,
    "close": 13.6567,
    "volume": 48615000.0
  },
  {
    "Unnamed: 0": 1072,
    "time": 1424217600,
    "open": 13.6627,
    "high": 13.7447,
    "low": 13.5067,
    "close": 13.6,
    "volume": 66528000.0
  },
  {
    "Unnamed: 0": 1073,
    "time": 1424304000,
    "open": 13.626,
    "high": 14.1627,
    "low": 13.5833,
    "close": 14.1067,
    "volume": 65745000.0
  },
  {
    "Unnamed: 0": 1074,
    "time": 1424390400,
    "open": 14.106,
    "high": 14.5067,
    "low": 13.98,
    "close": 14.4767,
    "volume": 78301500.0
  },
  {
    "Unnamed: 0": 1075,
    "time": 1424649600,
    "open": 14.4,
    "high": 14.5467,
    "low": 13.7553,
    "close": 13.7767,
    "volume": 112644000.0
  },
  {
    "Unnamed: 0": 1076,
    "time": 1424736000,
    "open": 13.792,
    "high": 13.8573,
    "low": 13.4467,
    "close": 13.5633,
    "volume": 87600000.0
  },
  {
    "Unnamed: 0": 1077,
    "time": 1424822400,
    "open": 13.5667,
    "high": 13.8093,
    "low": 13.5053,
    "close": 13.59,
    "volume": 52257000.0
  },
  {
    "Unnamed: 0": 1078,
    "time": 1424908800,
    "open": 13.6147,
    "high": 14.0727,
    "low": 13.4813,
    "close": 13.824,
    "volume": 86088000.0
  },
  {
    "Unnamed: 0": 1079,
    "time": 1424995200,
    "open": 13.8267,
    "high": 13.9033,
    "low": 13.52,
    "close": 13.5567,
    "volume": 50161500.0
  },
  {
    "Unnamed: 0": 1080,
    "time": 1425254400,
    "open": 13.5333,
    "high": 13.5733,
    "low": 13.0547,
    "close": 13.1533,
    "volume": 101004000.0
  },
  {
    "Unnamed: 0": 1081,
    "time": 1425340800,
    "open": 13.1867,
    "high": 13.35,
    "low": 13.0213,
    "close": 13.2933,
    "volume": 57592500.0
  },
  {
    "Unnamed: 0": 1082,
    "time": 1425427200,
    "open": 13.2447,
    "high": 13.5013,
    "low": 13.1473,
    "close": 13.45,
    "volume": 57156000.0
  },
  {
    "Unnamed: 0": 1083,
    "time": 1425513600,
    "open": 13.5353,
    "high": 13.746,
    "low": 13.3407,
    "close": 13.3573,
    "volume": 65712000.0
  },
  {
    "Unnamed: 0": 1084,
    "time": 1425600000,
    "open": 13.3347,
    "high": 13.4,
    "low": 12.81,
    "close": 12.978,
    "volume": 87417000.0
  },
  {
    "Unnamed: 0": 1085,
    "time": 1425859200,
    "open": 12.898,
    "high": 12.974,
    "low": 12.55,
    "close": 12.75,
    "volume": 87274500.0
  },
  {
    "Unnamed: 0": 1086,
    "time": 1425945600,
    "open": 12.6667,
    "high": 12.9,
    "low": 12.5067,
    "close": 12.688,
    "volume": 69730500.0
  },
  {
    "Unnamed: 0": 1087,
    "time": 1426032000,
    "open": 12.7,
    "high": 13.0787,
    "low": 12.6953,
    "close": 12.9007,
    "volume": 64245000.0
  },
  {
    "Unnamed: 0": 1088,
    "time": 1426118400,
    "open": 12.9167,
    "high": 12.9633,
    "low": 12.65,
    "close": 12.7573,
    "volume": 53023500.0
  },
  {
    "Unnamed: 0": 1089,
    "time": 1426204800,
    "open": 12.7573,
    "high": 12.7867,
    "low": 12.4733,
    "close": 12.58,
    "volume": 67867500.0
  },
  {
    "Unnamed: 0": 1090,
    "time": 1432598400,
    "open": 16.4667,
    "high": 16.8,
    "low": 16.4333,
    "close": 16.5,
    "volume": 43978500.0
  },
  {
    "Unnamed: 0": 1091,
    "time": 1432684800,
    "open": 16.5733,
    "high": 16.6593,
    "low": 16.37,
    "close": 16.5013,
    "volume": 43153500.0
  },
  {
    "Unnamed: 0": 1092,
    "time": 1432771200,
    "open": 16.4907,
    "high": 16.79,
    "low": 16.3367,
    "close": 16.7773,
    "volume": 44253000.0
  },
  {
    "Unnamed: 0": 1093,
    "time": 1432857600,
    "open": 16.7587,
    "high": 16.858,
    "low": 16.6287,
    "close": 16.7167,
    "volume": 49329570.0
  },
  {
    "Unnamed: 0": 1094,
    "time": 1433116800,
    "open": 16.7987,
    "high": 16.8,
    "low": 16.498,
    "close": 16.63,
    "volume": 31530225.0
  },
  {
    "Unnamed: 0": 1095,
    "time": 1433203200,
    "open": 16.616,
    "high": 16.6667,
    "low": 16.42,
    "close": 16.5467,
    "volume": 26885745.0
  },
  {
    "Unnamed: 0": 1096,
    "time": 1433289600,
    "open": 16.6,
    "high": 16.7147,
    "low": 16.4673,
    "close": 16.6033,
    "volume": 22884615.0
  },
  {
    "Unnamed: 0": 1097,
    "time": 1433376000,
    "open": 16.4807,
    "high": 16.62,
    "low": 16.3667,
    "close": 16.3667,
    "volume": 30814980.0
  },
  {
    "Unnamed: 0": 1098,
    "time": 1433462400,
    "open": 16.384,
    "high": 16.6467,
    "low": 16.3533,
    "close": 16.61,
    "volume": 40628865.0
  },
  {
    "Unnamed: 0": 1099,
    "time": 1433721600,
    "open": 16.6873,
    "high": 17.25,
    "low": 16.58,
    "close": 17.1233,
    "volume": 65460270.0
  },
  {
    "Unnamed: 0": 1100,
    "time": 1433808000,
    "open": 17.0333,
    "high": 17.1827,
    "low": 16.9427,
    "close": 16.9807,
    "volume": 32805165.0
  },
  {
    "Unnamed: 0": 1101,
    "time": 1433894400,
    "open": 17.0667,
    "high": 17.1033,
    "low": 16.5487,
    "close": 16.7133,
    "volume": 43567065.0
  },
  {
    "Unnamed: 0": 1102,
    "time": 1433980800,
    "open": 16.8333,
    "high": 16.9793,
    "low": 16.6953,
    "close": 16.7167,
    "volume": 26028345.0
  },
  {
    "Unnamed: 0": 1103,
    "time": 1434067200,
    "open": 16.7073,
    "high": 16.8973,
    "low": 16.6767,
    "close": 16.7307,
    "volume": 18391890.0
  },
  {
    "Unnamed: 0": 1104,
    "time": 1434326400,
    "open": 16.6947,
    "high": 16.752,
    "low": 16.4007,
    "close": 16.6973,
    "volume": 27654165.0
  },
  {
    "Unnamed: 0": 1105,
    "time": 1434412800,
    "open": 16.6287,
    "high": 16.896,
    "low": 16.606,
    "close": 16.882,
    "volume": 24904965.0
  },
  {
    "Unnamed: 0": 1106,
    "time": 1434499200,
    "open": 16.8833,
    "high": 17.624,
    "low": 16.8,
    "close": 17.4207,
    "volume": 70233015.0
  },
  {
    "Unnamed: 0": 1107,
    "time": 1434585600,
    "open": 17.3647,
    "high": 17.564,
    "low": 17.3333,
    "close": 17.46,
    "volume": 35891805.0
  },
  {
    "Unnamed: 0": 1108,
    "time": 1434672000,
    "open": 17.5147,
    "high": 17.5867,
    "low": 17.34,
    "close": 17.5,
    "volume": 32618625.0
  },
  {
    "Unnamed: 0": 1109,
    "time": 1434931200,
    "open": 17.7,
    "high": 17.7313,
    "low": 17.046,
    "close": 17.3233,
    "volume": 60604575.0
  },
  {
    "Unnamed: 0": 1110,
    "time": 1435017600,
    "open": 17.3713,
    "high": 17.8667,
    "low": 17.238,
    "close": 17.84,
    "volume": 50767455.0
  },
  {
    "Unnamed: 0": 1111,
    "time": 1435104000,
    "open": 17.8547,
    "high": 17.8547,
    "low": 17.5813,
    "close": 17.66,
    "volume": 29859885.0
  },
  {
    "Unnamed: 0": 1112,
    "time": 1435190400,
    "open": 17.732,
    "high": 18.094,
    "low": 17.68,
    "close": 17.9133,
    "volume": 37257870.0
  },
  {
    "Unnamed: 0": 1113,
    "time": 1435276800,
    "open": 17.9067,
    "high": 17.9673,
    "low": 17.7333,
    "close": 17.8173,
    "volume": 46306020.0
  },
  {
    "Unnamed: 0": 1114,
    "time": 1435536000,
    "open": 17.6,
    "high": 17.73,
    "low": 17.3267,
    "close": 17.4833,
    "volume": 44892210.0
  },
  {
    "Unnamed: 0": 1115,
    "time": 1435622400,
    "open": 17.482,
    "high": 18.0613,
    "low": 17.482,
    "close": 17.9167,
    "volume": 40032600.0
  },
  {
    "Unnamed: 0": 1116,
    "time": 1435708800,
    "open": 17.9667,
    "high": 18.2333,
    "low": 17.8567,
    "close": 17.9567,
    "volume": 26522145.0
  },
  {
    "Unnamed: 0": 1117,
    "time": 1435795200,
    "open": 17.956,
    "high": 18.8453,
    "low": 17.9067,
    "close": 18.6507,
    "volume": 89596185.0
  },
  {
    "Unnamed: 0": 1118,
    "time": 1436140800,
    "open": 18.5993,
    "high": 18.7913,
    "low": 18.42,
    "close": 18.6867,
    "volume": 51407370.0
  },
  {
    "Unnamed: 0": 1119,
    "time": 1436227200,
    "open": 18.4233,
    "high": 18.4933,
    "low": 17.3847,
    "close": 17.71,
    "volume": 76788555.0
  },
  {
    "Unnamed: 0": 1120,
    "time": 1436313600,
    "open": 17.5673,
    "high": 17.5993,
    "low": 16.954,
    "close": 17.0147,
    "volume": 77151690.0
  },
  {
    "Unnamed: 0": 1121,
    "time": 1436400000,
    "open": 17.24,
    "high": 17.532,
    "low": 17.1193,
    "close": 17.2667,
    "volume": 42350805.0
  },
  {
    "Unnamed: 0": 1122,
    "time": 1436486400,
    "open": 17.294,
    "high": 17.6467,
    "low": 17.188,
    "close": 17.2787,
    "volume": 32995410.0
  },
  {
    "Unnamed: 0": 1123,
    "time": 1436745600,
    "open": 17.4133,
    "high": 17.5227,
    "low": 17.07,
    "close": 17.46,
    "volume": 37339440.0
  },
  {
    "Unnamed: 0": 1124,
    "time": 1436832000,
    "open": 17.536,
    "high": 17.7867,
    "low": 17.3673,
    "close": 17.6833,
    "volume": 23937300.0
  },
  {
    "Unnamed: 0": 1125,
    "time": 1436918400,
    "open": 17.7853,
    "high": 17.9033,
    "low": 17.4067,
    "close": 17.5213,
    "volume": 24810810.0
  },
  {
    "Unnamed: 0": 1126,
    "time": 1437004800,
    "open": 17.6873,
    "high": 18.0587,
    "low": 17.544,
    "close": 17.9667,
    "volume": 19932795.0
  },
  {
    "Unnamed: 0": 1127,
    "time": 1437091200,
    "open": 18.0193,
    "high": 18.3693,
    "low": 17.8833,
    "close": 18.31,
    "volume": 64817235.0
  },
  {
    "Unnamed: 0": 1128,
    "time": 1437350400,
    "open": 18.4333,
    "high": 19.11,
    "low": 18.1693,
    "close": 18.8267,
    "volume": 62984370.0
  },
  {
    "Unnamed: 0": 1129,
    "time": 1437436800,
    "open": 18.8313,
    "high": 18.8313,
    "low": 17.608,
    "close": 17.6667,
    "volume": 76316850.0
  },
  {
    "Unnamed: 0": 1130,
    "time": 1437523200,
    "open": 17.6333,
    "high": 17.9627,
    "low": 17.3333,
    "close": 17.858,
    "volume": 38555175.0
  },
  {
    "Unnamed: 0": 1131,
    "time": 1437609600,
    "open": 18.0067,
    "high": 18.0067,
    "low": 17.6847,
    "close": 17.8533,
    "volume": 28486500.0
  },
  {
    "Unnamed: 0": 1132,
    "time": 1437696000,
    "open": 17.9267,
    "high": 18.0727,
    "low": 17.5947,
    "close": 17.7067,
    "volume": 37048095.0
  },
  {
    "Unnamed: 0": 1133,
    "time": 1437955200,
    "open": 17.682,
    "high": 17.682,
    "low": 16.7193,
    "close": 16.88,
    "volume": 60568065.0
  },
  {
    "Unnamed: 0": 1134,
    "time": 1438041600,
    "open": 17.0113,
    "high": 17.6933,
    "low": 16.7887,
    "close": 17.6933,
    "volume": 48846450.0
  },
  {
    "Unnamed: 0": 1135,
    "time": 1438128000,
    "open": 17.7187,
    "high": 17.8593,
    "low": 17.4667,
    "close": 17.5753,
    "volume": 34009380.0
  },
  {
    "Unnamed: 0": 1136,
    "time": 1438214400,
    "open": 17.6133,
    "high": 17.8293,
    "low": 17.474,
    "close": 17.7987,
    "volume": 26370390.0
  },
  {
    "Unnamed: 0": 1137,
    "time": 1438300800,
    "open": 17.8767,
    "high": 17.9573,
    "low": 17.674,
    "close": 17.6933,
    "volume": 27594270.0
  },
  {
    "Unnamed: 0": 1138,
    "time": 1438560000,
    "open": 17.7333,
    "high": 17.842,
    "low": 17.138,
    "close": 17.3433,
    "volume": 32603745.0
  },
  {
    "Unnamed: 0": 1139,
    "time": 1438646400,
    "open": 17.338,
    "high": 17.7813,
    "low": 17.2227,
    "close": 17.6833,
    "volume": 28507875.0
  },
  {
    "Unnamed: 0": 1140,
    "time": 1438732800,
    "open": 17.7933,
    "high": 18.4667,
    "low": 16.3333,
    "close": 17.0,
    "volume": 68174265.0
  },
  {
    "Unnamed: 0": 1141,
    "time": 1438819200,
    "open": 17.0133,
    "high": 17.0493,
    "low": 15.7413,
    "close": 16.3833,
    "volume": 189249225.0
  },
  {
    "Unnamed: 0": 1142,
    "time": 1438905600,
    "open": 16.3533,
    "high": 16.4087,
    "low": 15.8927,
    "close": 16.1673,
    "volume": 67028235.0
  },
  {
    "Unnamed: 0": 1143,
    "time": 1439164800,
    "open": 16.1333,
    "high": 16.198,
    "low": 15.7367,
    "close": 16.04,
    "volume": 53537460.0
  },
  {
    "Unnamed: 0": 1144,
    "time": 1439251200,
    "open": 15.9033,
    "high": 15.9533,
    "low": 15.6293,
    "close": 15.8247,
    "volume": 52796445.0
  },
  {
    "Unnamed: 0": 1145,
    "time": 1439337600,
    "open": 15.7073,
    "high": 15.9847,
    "low": 15.4913,
    "close": 15.9347,
    "volume": 46502790.0
  },
  {
    "Unnamed: 0": 1146,
    "time": 1439424000,
    "open": 16.0133,
    "high": 16.432,
    "low": 15.9267,
    "close": 16.208,
    "volume": 58656540.0
  },
  {
    "Unnamed: 0": 1147,
    "time": 1439510400,
    "open": 16.1967,
    "high": 16.6147,
    "low": 16.118,
    "close": 16.2567,
    "volume": 53596260.0
  },
  {
    "Unnamed: 0": 1148,
    "time": 1439769600,
    "open": 16.3333,
    "high": 17.2587,
    "low": 16.3333,
    "close": 17.02,
    "volume": 88423530.0
  },
  {
    "Unnamed: 0": 1149,
    "time": 1439856000,
    "open": 17.1,
    "high": 17.4,
    "low": 16.904,
    "close": 17.3733,
    "volume": 53375535.0
  },
  {
    "Unnamed: 0": 1150,
    "time": 1439942400,
    "open": 17.4673,
    "high": 17.4673,
    "low": 16.964,
    "close": 16.9867,
    "volume": 46379340.0
  },
  {
    "Unnamed: 0": 1151,
    "time": 1440028800,
    "open": 16.8687,
    "high": 16.9707,
    "low": 16.0007,
    "close": 16.034,
    "volume": 62651175.0
  },
  {
    "Unnamed: 0": 1152,
    "time": 1440115200,
    "open": 16.044,
    "high": 16.2533,
    "low": 15.314,
    "close": 15.3433,
    "volume": 83421645.0
  },
  {
    "Unnamed: 0": 1153,
    "time": 1440374400,
    "open": 14.5667,
    "high": 15.4267,
    "low": 13.0,
    "close": 14.6667,
    "volume": 120938985.0
  },
  {
    "Unnamed: 0": 1154,
    "time": 1440460800,
    "open": 15.2667,
    "high": 15.5333,
    "low": 14.5667,
    "close": 14.5667,
    "volume": 53007090.0
  },
  {
    "Unnamed: 0": 1155,
    "time": 1440547200,
    "open": 15.1493,
    "high": 15.3333,
    "low": 14.3673,
    "close": 15.02,
    "volume": 63997230.0
  },
  {
    "Unnamed: 0": 1156,
    "time": 1440633600,
    "open": 15.318,
    "high": 16.3167,
    "low": 15.2593,
    "close": 16.2173,
    "volume": 98315805.0
  },
  {
    "Unnamed: 0": 1157,
    "time": 1440720000,
    "open": 16.1307,
    "high": 16.7633,
    "low": 15.9333,
    "close": 16.592,
    "volume": 71507475.0
  },
  {
    "Unnamed: 0": 1158,
    "time": 1440979200,
    "open": 16.2647,
    "high": 16.9967,
    "low": 16.236,
    "close": 16.474,
    "volume": 122503890.0
  },
  {
    "Unnamed: 0": 1159,
    "time": 1441065600,
    "open": 16.3333,
    "high": 16.4,
    "low": 15.798,
    "close": 15.9733,
    "volume": 71484615.0
  },
  {
    "Unnamed: 0": 1160,
    "time": 1441152000,
    "open": 15.9453,
    "high": 17.0327,
    "low": 15.9453,
    "close": 16.9333,
    "volume": 61671885.0
  },
  {
    "Unnamed: 0": 1161,
    "time": 1441238400,
    "open": 16.9167,
    "high": 17.0033,
    "low": 16.2067,
    "close": 16.2333,
    "volume": 53779770.0
  },
  {
    "Unnamed: 0": 1162,
    "time": 1441324800,
    "open": 16.1453,
    "high": 16.2727,
    "low": 15.88,
    "close": 16.1287,
    "volume": 47893560.0
  },
  {
    "Unnamed: 0": 1163,
    "time": 1441670400,
    "open": 16.53,
    "high": 16.75,
    "low": 16.27,
    "close": 16.686,
    "volume": 40088835.0
  },
  {
    "Unnamed: 0": 1164,
    "time": 1441756800,
    "open": 16.6867,
    "high": 16.9627,
    "low": 16.5333,
    "close": 16.6053,
    "volume": 43224345.0
  },
  {
    "Unnamed: 0": 1165,
    "time": 1441843200,
    "open": 16.7107,
    "high": 16.8007,
    "low": 16.3553,
    "close": 16.5933,
    "volume": 33505485.0
  },
  {
    "Unnamed: 0": 1166,
    "time": 1441929600,
    "open": 16.4667,
    "high": 16.6927,
    "low": 16.3153,
    "close": 16.69,
    "volume": 30261885.0
  },
  {
    "Unnamed: 0": 1167,
    "time": 1442188800,
    "open": 16.7313,
    "high": 16.95,
    "low": 16.6033,
    "close": 16.876,
    "volume": 37000215.0
  },
  {
    "Unnamed: 0": 1168,
    "time": 1442275200,
    "open": 16.82,
    "high": 16.9733,
    "low": 16.6333,
    "close": 16.93,
    "volume": 37735680.0
  },
  {
    "Unnamed: 0": 1169,
    "time": 1442361600,
    "open": 16.9453,
    "high": 17.5253,
    "low": 16.8587,
    "close": 17.4993,
    "volume": 53034555.0
  },
  {
    "Unnamed: 0": 1170,
    "time": 1442448000,
    "open": 17.4547,
    "high": 17.7,
    "low": 17.3793,
    "close": 17.4607,
    "volume": 44743740.0
  },
  {
    "Unnamed: 0": 1171,
    "time": 1442534400,
    "open": 17.4533,
    "high": 17.588,
    "low": 17.16,
    "close": 17.3327,
    "volume": 46208550.0
  },
  {
    "Unnamed: 0": 1172,
    "time": 1442793600,
    "open": 17.3153,
    "high": 18.1047,
    "low": 17.0533,
    "close": 17.6667,
    "volume": 78873465.0
  },
  {
    "Unnamed: 0": 1173,
    "time": 1442880000,
    "open": 17.5853,
    "high": 17.5853,
    "low": 17.058,
    "close": 17.3973,
    "volume": 47461185.0
  },
  {
    "Unnamed: 0": 1174,
    "time": 1442966400,
    "open": 17.2933,
    "high": 17.5313,
    "low": 17.172,
    "close": 17.3973,
    "volume": 33568950.0
  },
  {
    "Unnamed: 0": 1175,
    "time": 1443052800,
    "open": 17.3867,
    "high": 17.5667,
    "low": 17.0807,
    "close": 17.5667,
    "volume": 43135980.0
  },
  {
    "Unnamed: 0": 1176,
    "time": 1443139200,
    "open": 17.6,
    "high": 17.8167,
    "low": 17.0767,
    "close": 17.13,
    "volume": 49134375.0
  },
  {
    "Unnamed: 0": 1177,
    "time": 1443398400,
    "open": 17.1893,
    "high": 17.3193,
    "low": 16.4407,
    "close": 16.6053,
    "volume": 127229130.0
  },
  {
    "Unnamed: 0": 1178,
    "time": 1443484800,
    "open": 16.7333,
    "high": 16.982,
    "low": 16.364,
    "close": 16.4467,
    "volume": 47435895.0
  },
  {
    "Unnamed: 0": 1179,
    "time": 1443571200,
    "open": 16.6247,
    "high": 16.926,
    "low": 16.156,
    "close": 16.5633,
    "volume": 62164515.0
  },
  {
    "Unnamed: 0": 1180,
    "time": 1443657600,
    "open": 16.6433,
    "high": 16.6433,
    "low": 15.8087,
    "close": 15.9667,
    "volume": 56504925.0
  },
  {
    "Unnamed: 0": 1181,
    "time": 1443744000,
    "open": 16.038,
    "high": 16.7333,
    "low": 15.5333,
    "close": 16.5667,
    "volume": 54307740.0
  },
  {
    "Unnamed: 0": 1182,
    "time": 1444003200,
    "open": 16.6673,
    "high": 16.7333,
    "low": 16.2753,
    "close": 16.354,
    "volume": 48077100.0
  },
  {
    "Unnamed: 0": 1183,
    "time": 1444089600,
    "open": 16.3327,
    "high": 16.3327,
    "low": 15.7053,
    "close": 15.95,
    "volume": 65567505.0
  },
  {
    "Unnamed: 0": 1184,
    "time": 1444176000,
    "open": 15.7947,
    "high": 15.8667,
    "low": 15.2747,
    "close": 15.46,
    "volume": 89247075.0
  },
  {
    "Unnamed: 0": 1185,
    "time": 1444262400,
    "open": 15.378,
    "high": 15.424,
    "low": 14.754,
    "close": 15.0,
    "volume": 77791965.0
  },
  {
    "Unnamed: 0": 1186,
    "time": 1444348800,
    "open": 14.7333,
    "high": 14.958,
    "low": 14.5333,
    "close": 14.6933,
    "volume": 79845975.0
  },
  {
    "Unnamed: 0": 1187,
    "time": 1444608000,
    "open": 14.8,
    "high": 14.9067,
    "low": 14.2793,
    "close": 14.3,
    "volume": 49668135.0
  },
  {
    "Unnamed: 0": 1188,
    "time": 1444694400,
    "open": 14.3067,
    "high": 14.8353,
    "low": 14.0753,
    "close": 14.6,
    "volume": 67942260.0
  },
  {
    "Unnamed: 0": 1189,
    "time": 1444780800,
    "open": 14.6173,
    "high": 14.7433,
    "low": 14.362,
    "close": 14.4933,
    "volume": 39930165.0
  },
  {
    "Unnamed: 0": 1190,
    "time": 1444867200,
    "open": 14.59,
    "high": 14.8627,
    "low": 14.2467,
    "close": 14.8627,
    "volume": 36025155.0
  },
  {
    "Unnamed: 0": 1191,
    "time": 1444953600,
    "open": 14.788,
    "high": 15.366,
    "low": 14.788,
    "close": 15.11,
    "volume": 56215725.0
  },
  {
    "Unnamed: 0": 1192,
    "time": 1445212800,
    "open": 15.2293,
    "high": 15.41,
    "low": 14.996,
    "close": 15.15,
    "volume": 31590870.0
  },
  {
    "Unnamed: 0": 1193,
    "time": 1445299200,
    "open": 15.1667,
    "high": 15.24,
    "low": 13.4667,
    "close": 14.1107,
    "volume": 197281935.0
  },
  {
    "Unnamed: 0": 1194,
    "time": 1445385600,
    "open": 14.2267,
    "high": 14.3207,
    "low": 13.92,
    "close": 14.0667,
    "volume": 53924745.0
  },
  {
    "Unnamed: 0": 1195,
    "time": 1445472000,
    "open": 14.134,
    "high": 14.3833,
    "low": 13.96,
    "close": 14.2,
    "volume": 35633430.0
  },
  {
    "Unnamed: 0": 1196,
    "time": 1445558400,
    "open": 14.4527,
    "high": 14.5333,
    "low": 13.846,
    "close": 14.0,
    "volume": 54594090.0
  },
  {
    "Unnamed: 0": 1197,
    "time": 1445817600,
    "open": 14.0327,
    "high": 14.4667,
    "low": 13.9267,
    "close": 14.38,
    "volume": 42132645.0
  },
  {
    "Unnamed: 0": 1198,
    "time": 1445904000,
    "open": 14.372,
    "high": 14.4733,
    "low": 13.834,
    "close": 14.0233,
    "volume": 45352560.0
  },
  {
    "Unnamed: 0": 1199,
    "time": 1445990400,
    "open": 14.0473,
    "high": 14.23,
    "low": 13.8867,
    "close": 14.1867,
    "volume": 34321920.0
  },
  {
    "Unnamed: 0": 1200,
    "time": 1446076800,
    "open": 14.1333,
    "high": 14.25,
    "low": 13.94,
    "close": 14.0007,
    "volume": 23203560.0
  },
  {
    "Unnamed: 0": 1201,
    "time": 1446163200,
    "open": 14.0933,
    "high": 14.1087,
    "low": 13.5927,
    "close": 13.7927,
    "volume": 55364160.0
  },
  {
    "Unnamed: 0": 1202,
    "time": 1446422400,
    "open": 13.7933,
    "high": 14.3867,
    "low": 13.7933,
    "close": 14.2633,
    "volume": 49048695.0
  },
  {
    "Unnamed: 0": 1203,
    "time": 1446508800,
    "open": 14.26,
    "high": 15.5967,
    "low": 13.5,
    "close": 15.1713,
    "volume": 81725865.0
  },
  {
    "Unnamed: 0": 1204,
    "time": 1446595200,
    "open": 14.998,
    "high": 15.516,
    "low": 14.8,
    "close": 15.4233,
    "volume": 164936790.0
  },
  {
    "Unnamed: 0": 1205,
    "time": 1446681600,
    "open": 15.442,
    "high": 15.6393,
    "low": 15.2793,
    "close": 15.46,
    "volume": 57396345.0
  },
  {
    "Unnamed: 0": 1206,
    "time": 1446768000,
    "open": 15.4333,
    "high": 15.5573,
    "low": 15.3,
    "close": 15.5,
    "volume": 62338770.0
  },
  {
    "Unnamed: 0": 1207,
    "time": 1447027200,
    "open": 15.4507,
    "high": 15.5327,
    "low": 14.954,
    "close": 14.9993,
    "volume": 49130655.0
  },
  {
    "Unnamed: 0": 1208,
    "time": 1447113600,
    "open": 14.99,
    "high": 15.0,
    "low": 14.4053,
    "close": 14.44,
    "volume": 58650945.0
  },
  {
    "Unnamed: 0": 1209,
    "time": 1447200000,
    "open": 14.5527,
    "high": 14.632,
    "low": 14.242,
    "close": 14.6267,
    "volume": 42948015.0
  },
  {
    "Unnamed: 0": 1210,
    "time": 1447286400,
    "open": 14.5953,
    "high": 14.6,
    "low": 14.16,
    "close": 14.1667,
    "volume": 37479450.0
  },
  {
    "Unnamed: 0": 1211,
    "time": 1447372800,
    "open": 14.16,
    "high": 14.22,
    "low": 13.6947,
    "close": 13.702,
    "volume": 42982740.0
  },
  {
    "Unnamed: 0": 1212,
    "time": 1447632000,
    "open": 13.7667,
    "high": 14.332,
    "low": 13.7,
    "close": 14.28,
    "volume": 37396095.0
  },
  {
    "Unnamed: 0": 1213,
    "time": 1447718400,
    "open": 14.3447,
    "high": 14.4,
    "low": 14.0933,
    "close": 14.2667,
    "volume": 27685005.0
  },
  {
    "Unnamed: 0": 1214,
    "time": 1447804800,
    "open": 14.3267,
    "high": 14.7587,
    "low": 14.168,
    "close": 14.68,
    "volume": 36768795.0
  },
  {
    "Unnamed: 0": 1215,
    "time": 1447891200,
    "open": 14.864,
    "high": 15.0793,
    "low": 14.6867,
    "close": 14.74,
    "volume": 30967155.0
  },
  {
    "Unnamed: 0": 1216,
    "time": 1447977600,
    "open": 14.7867,
    "high": 15.0,
    "low": 14.2387,
    "close": 14.664,
    "volume": 57603405.0
  },
  {
    "Unnamed: 0": 1217,
    "time": 1448236800,
    "open": 14.6673,
    "high": 14.6673,
    "low": 14.3113,
    "close": 14.4933,
    "volume": 31581555.0
  },
  {
    "Unnamed: 0": 1218,
    "time": 1448323200,
    "open": 14.4,
    "high": 14.7333,
    "low": 14.3333,
    "close": 14.4733,
    "volume": 31788765.0
  },
  {
    "Unnamed: 0": 1219,
    "time": 1448409600,
    "open": 14.5667,
    "high": 15.3887,
    "low": 14.5667,
    "close": 15.3533,
    "volume": 51472185.0
  },
  {
    "Unnamed: 0": 1220,
    "time": 1448582400,
    "open": 15.3913,
    "high": 15.4833,
    "low": 15.134,
    "close": 15.3353,
    "volume": 24905370.0
  },
  {
    "Unnamed: 0": 1221,
    "time": 1448841600,
    "open": 15.4367,
    "high": 15.6187,
    "low": 15.272,
    "close": 15.3667,
    "volume": 33631095.0
  },
  {
    "Unnamed: 0": 1222,
    "time": 1448928000,
    "open": 15.404,
    "high": 15.8667,
    "low": 15.32,
    "close": 15.82,
    "volume": 47844060.0
  },
  {
    "Unnamed: 0": 1223,
    "time": 1449014400,
    "open": 15.81,
    "high": 15.9067,
    "low": 15.4153,
    "close": 15.532,
    "volume": 37548885.0
  },
  {
    "Unnamed: 0": 1224,
    "time": 1449100800,
    "open": 15.56,
    "high": 15.83,
    "low": 15.3333,
    "close": 15.5667,
    "volume": 37645980.0
  },
  {
    "Unnamed: 0": 1225,
    "time": 1449187200,
    "open": 15.6,
    "high": 15.63,
    "low": 15.1773,
    "close": 15.3933,
    "volume": 32882220.0
  },
  {
    "Unnamed: 0": 1226,
    "time": 1449446400,
    "open": 15.3587,
    "high": 15.7087,
    "low": 15.0767,
    "close": 15.3933,
    "volume": 40632900.0
  },
  {
    "Unnamed: 0": 1227,
    "time": 1449532800,
    "open": 15.2667,
    "high": 15.2667,
    "low": 14.9467,
    "close": 15.18,
    "volume": 34195545.0
  },
  {
    "Unnamed: 0": 1228,
    "time": 1449619200,
    "open": 15.0667,
    "high": 15.1667,
    "low": 14.7147,
    "close": 14.9873,
    "volume": 39684090.0
  },
  {
    "Unnamed: 0": 1229,
    "time": 1449705600,
    "open": 14.9993,
    "high": 15.2327,
    "low": 14.9093,
    "close": 15.1653,
    "volume": 26159520.0
  },
  {
    "Unnamed: 0": 1230,
    "time": 1449792000,
    "open": 15.0053,
    "high": 15.05,
    "low": 14.36,
    "close": 14.432,
    "volume": 42714765.0
  },
  {
    "Unnamed: 0": 1231,
    "time": 1450051200,
    "open": 14.6587,
    "high": 14.728,
    "low": 14.3247,
    "close": 14.572,
    "volume": 35973795.0
  },
  {
    "Unnamed: 0": 1232,
    "time": 1450137600,
    "open": 14.7333,
    "high": 14.8287,
    "low": 14.5333,
    "close": 14.7267,
    "volume": 28405860.0
  },
  {
    "Unnamed: 0": 1233,
    "time": 1450224000,
    "open": 14.8333,
    "high": 15.6587,
    "low": 14.7153,
    "close": 15.5833,
    "volume": 64146990.0
  },
  {
    "Unnamed: 0": 1234,
    "time": 1450310400,
    "open": 15.69,
    "high": 15.8507,
    "low": 15.3207,
    "close": 15.4733,
    "volume": 40449015.0
  },
  {
    "Unnamed: 0": 1235,
    "time": 1450396800,
    "open": 15.4,
    "high": 15.7267,
    "low": 15.286,
    "close": 15.3833,
    "volume": 38668740.0
  },
  {
    "Unnamed: 0": 1236,
    "time": 1450656000,
    "open": 15.4667,
    "high": 15.722,
    "low": 15.4,
    "close": 15.5333,
    "volume": 24367620.0
  },
  {
    "Unnamed: 0": 1237,
    "time": 1450742400,
    "open": 15.5333,
    "high": 15.77,
    "low": 15.3087,
    "close": 15.3467,
    "volume": 25559175.0
  },
  {
    "Unnamed: 0": 1238,
    "time": 1450828800,
    "open": 15.4667,
    "high": 15.5633,
    "low": 15.2087,
    "close": 15.3133,
    "volume": 18879060.0
  },
  {
    "Unnamed: 0": 1239,
    "time": 1450915200,
    "open": 15.3133,
    "high": 15.4587,
    "low": 15.2187,
    "close": 15.3713,
    "volume": 8807865.0
  },
  {
    "Unnamed: 0": 1240,
    "time": 1451260800,
    "open": 15.3573,
    "high": 15.4653,
    "low": 15.036,
    "close": 15.2667,
    "volume": 22891215.0
  },
  {
    "Unnamed: 0": 1241,
    "time": 1451347200,
    "open": 15.3167,
    "high": 15.86,
    "low": 15.3027,
    "close": 15.86,
    "volume": 31348185.0
  },
  {
    "Unnamed: 0": 1242,
    "time": 1451433600,
    "open": 15.7387,
    "high": 16.2427,
    "low": 15.7113,
    "close": 15.9133,
    "volume": 47373570.0
  },
  {
    "Unnamed: 0": 1243,
    "time": 1451520000,
    "open": 16.0,
    "high": 16.23,
    "low": 15.8913,
    "close": 16.0,
    "volume": 35687385.0
  },
  {
    "Unnamed: 0": 1244,
    "time": 1451865600,
    "open": 15.5733,
    "high": 15.9667,
    "low": 14.6,
    "close": 14.9727,
    "volume": 84687525.0
  },
  {
    "Unnamed: 0": 1245,
    "time": 1451952000,
    "open": 14.934,
    "high": 15.126,
    "low": 14.6667,
    "close": 14.85,
    "volume": 39873360.0
  },
  {
    "Unnamed: 0": 1246,
    "time": 1452038400,
    "open": 14.6047,
    "high": 14.7167,
    "low": 14.3987,
    "close": 14.7167,
    "volume": 45644085.0
  },
  {
    "Unnamed: 0": 1247,
    "time": 1452124800,
    "open": 14.5333,
    "high": 14.5627,
    "low": 14.144,
    "close": 14.334,
    "volume": 44442075.0
  },
  {
    "Unnamed: 0": 1248,
    "time": 1452211200,
    "open": 14.4133,
    "high": 14.696,
    "low": 14.03,
    "close": 14.0753,
    "volume": 42351450.0
  },
  {
    "Unnamed: 0": 1249,
    "time": 1452470400,
    "open": 14.0633,
    "high": 14.2967,
    "low": 13.5333,
    "close": 13.8287,
    "volume": 51419670.0
  },
  {
    "Unnamed: 0": 1250,
    "time": 1452556800,
    "open": 13.9893,
    "high": 14.2493,
    "low": 13.6873,
    "close": 14.066,
    "volume": 37346910.0
  },
  {
    "Unnamed: 0": 1251,
    "time": 1452643200,
    "open": 14.17,
    "high": 14.1767,
    "low": 13.3333,
    "close": 13.4,
    "volume": 45447780.0
  },
  {
    "Unnamed: 0": 1252,
    "time": 1452729600,
    "open": 13.3667,
    "high": 14.0,
    "low": 12.892,
    "close": 13.8033,
    "volume": 78481125.0
  },
  {
    "Unnamed: 0": 1253,
    "time": 1452816000,
    "open": 13.4667,
    "high": 13.6793,
    "low": 13.1333,
    "close": 13.65,
    "volume": 65273250.0
  },
  {
    "Unnamed: 0": 1254,
    "time": 1453161600,
    "open": 13.992,
    "high": 14.0313,
    "low": 13.3853,
    "close": 13.6647,
    "volume": 49873515.0
  },
  {
    "Unnamed: 0": 1255,
    "time": 1453248000,
    "open": 13.5,
    "high": 13.5,
    "low": 12.75,
    "close": 13.346,
    "volume": 71760615.0
  },
  {
    "Unnamed: 0": 1256,
    "time": 1453334400,
    "open": 13.2,
    "high": 13.5487,
    "low": 13.0013,
    "close": 13.2733,
    "volume": 39395805.0
  },
  {
    "Unnamed: 0": 1257,
    "time": 1453420800,
    "open": 13.56,
    "high": 13.7667,
    "low": 13.2687,
    "close": 13.5033,
    "volume": 36423510.0
  },
  {
    "Unnamed: 0": 1258,
    "time": 1453680000,
    "open": 13.5033,
    "high": 13.5713,
    "low": 13.034,
    "close": 13.0667,
    "volume": 32746890.0
  },
  {
    "Unnamed: 0": 1259,
    "time": 1453766400,
    "open": 13.0767,
    "high": 13.2187,
    "low": 12.592,
    "close": 12.79,
    "volume": 61887765.0
  },
  {
    "Unnamed: 0": 1260,
    "time": 1453852800,
    "open": 12.8007,
    "high": 12.884,
    "low": 12.3847,
    "close": 12.6033,
    "volume": 43610685.0
  },
  {
    "Unnamed: 0": 1261,
    "time": 1453939200,
    "open": 12.6333,
    "high": 12.7933,
    "low": 12.1607,
    "close": 12.4327,
    "volume": 58177335.0
  },
  {
    "Unnamed: 0": 1262,
    "time": 1454025600,
    "open": 12.5853,
    "high": 12.916,
    "low": 12.5193,
    "close": 12.7787,
    "volume": 36289005.0
  },
  {
    "Unnamed: 0": 1263,
    "time": 1454284800,
    "open": 12.7167,
    "high": 13.3013,
    "low": 12.1833,
    "close": 13.088,
    "volume": 67881600.0
  },
  {
    "Unnamed: 0": 1264,
    "time": 1454371200,
    "open": 13.09,
    "high": 13.09,
    "low": 12.0153,
    "close": 12.18,
    "volume": 72660375.0
  },
  {
    "Unnamed: 0": 1265,
    "time": 1454457600,
    "open": 12.2467,
    "high": 12.3267,
    "low": 11.3453,
    "close": 11.572,
    "volume": 102199185.0
  },
  {
    "Unnamed: 0": 1266,
    "time": 1454544000,
    "open": 11.6373,
    "high": 11.732,
    "low": 11.1327,
    "close": 11.37,
    "volume": 55556535.0
  },
  {
    "Unnamed: 0": 1267,
    "time": 1454630400,
    "open": 11.4867,
    "high": 11.5627,
    "low": 10.516,
    "close": 10.8333,
    "volume": 121217820.0
  },
  {
    "Unnamed: 0": 1268,
    "time": 1454889600,
    "open": 10.6,
    "high": 10.6,
    "low": 9.7333,
    "close": 9.75,
    "volume": 117036630.0
  },
  {
    "Unnamed: 0": 1269,
    "time": 1454976000,
    "open": 9.798,
    "high": 10.6527,
    "low": 9.34,
    "close": 9.6667,
    "volume": 111349140.0
  },
  {
    "Unnamed: 0": 1270,
    "time": 1455062400,
    "open": 9.7533,
    "high": 10.9933,
    "low": 9.0,
    "close": 10.502,
    "volume": 114878790.0
  },
  {
    "Unnamed: 0": 1271,
    "time": 1455148800,
    "open": 10.2,
    "high": 10.884,
    "low": 9.6013,
    "close": 10.1333,
    "volume": 187276440.0
  },
  {
    "Unnamed: 0": 1272,
    "time": 1455235200,
    "open": 10.1333,
    "high": 10.4673,
    "low": 9.58,
    "close": 9.9967,
    "volume": 95316150.0
  },
  {
    "Unnamed: 0": 1273,
    "time": 1455580800,
    "open": 10.0993,
    "high": 10.8633,
    "low": 10.0993,
    "close": 10.3307,
    "volume": 72728055.0
  },
  {
    "Unnamed: 0": 1274,
    "time": 1455667200,
    "open": 10.4987,
    "high": 11.3447,
    "low": 10.4453,
    "close": 11.3447,
    "volume": 76193205.0
  },
  {
    "Unnamed: 0": 1275,
    "time": 1455753600,
    "open": 11.3533,
    "high": 11.5833,
    "low": 10.9847,
    "close": 11.1333,
    "volume": 49621590.0
  },
  {
    "Unnamed: 0": 1276,
    "time": 1455840000,
    "open": 11.0333,
    "high": 11.166,
    "low": 10.8333,
    "close": 11.1233,
    "volume": 36965385.0
  },
  {
    "Unnamed: 0": 1277,
    "time": 1456099200,
    "open": 11.3,
    "high": 11.9273,
    "low": 11.3,
    "close": 11.7967,
    "volume": 66003810.0
  },
  {
    "Unnamed: 0": 1278,
    "time": 1456185600,
    "open": 11.648,
    "high": 12.1153,
    "low": 11.5787,
    "close": 11.7667,
    "volume": 69213390.0
  },
  {
    "Unnamed: 0": 1279,
    "time": 1456272000,
    "open": 11.6733,
    "high": 12.0,
    "low": 11.1893,
    "close": 11.9993,
    "volume": 69879090.0
  },
  {
    "Unnamed: 0": 1280,
    "time": 1456358400,
    "open": 11.8887,
    "high": 12.568,
    "low": 11.68,
    "close": 12.4907,
    "volume": 67942905.0
  },
  {
    "Unnamed: 0": 1281,
    "time": 1456444800,
    "open": 12.6067,
    "high": 12.8,
    "low": 12.3333,
    "close": 12.6507,
    "volume": 78149805.0
  },
  {
    "Unnamed: 0": 1282,
    "time": 1456704000,
    "open": 12.6,
    "high": 13.09,
    "low": 12.6,
    "close": 12.7533,
    "volume": 115657890.0
  },
  {
    "Unnamed: 0": 1283,
    "time": 1456790400,
    "open": 12.9527,
    "high": 13.0633,
    "low": 12.18,
    "close": 12.3167,
    "volume": 87616590.0
  },
  {
    "Unnamed: 0": 1284,
    "time": 1456876800,
    "open": 12.3953,
    "high": 12.568,
    "low": 12.1,
    "close": 12.458,
    "volume": 62262495.0
  },
  {
    "Unnamed: 0": 1285,
    "time": 1456963200,
    "open": 12.556,
    "high": 13.1613,
    "low": 12.2813,
    "close": 13.0267,
    "volume": 63760695.0
  },
  {
    "Unnamed: 0": 1286,
    "time": 1457049600,
    "open": 13.04,
    "high": 13.602,
    "low": 13.04,
    "close": 13.3833,
    "volume": 86046540.0
  },
  {
    "Unnamed: 0": 1287,
    "time": 1457308800,
    "open": 13.3333,
    "high": 13.98,
    "low": 13.16,
    "close": 13.7,
    "volume": 67046235.0
  },
  {
    "Unnamed: 0": 1288,
    "time": 1457395200,
    "open": 13.6667,
    "high": 13.8333,
    "low": 13.48,
    "close": 13.5233,
    "volume": 53949945.0
  },
  {
    "Unnamed: 0": 1289,
    "time": 1457481600,
    "open": 13.5667,
    "high": 13.9587,
    "low": 13.5193,
    "close": 13.93,
    "volume": 41877810.0
  },
  {
    "Unnamed: 0": 1290,
    "time": 1457568000,
    "open": 13.93,
    "high": 14.2333,
    "low": 13.378,
    "close": 13.6787,
    "volume": 67059180.0
  },
  {
    "Unnamed: 0": 1291,
    "time": 1457654400,
    "open": 13.918,
    "high": 13.9613,
    "low": 13.6887,
    "close": 13.8347,
    "volume": 42624135.0
  },
  {
    "Unnamed: 0": 1292,
    "time": 1457913600,
    "open": 13.88,
    "high": 14.448,
    "low": 13.88,
    "close": 14.3667,
    "volume": 50652270.0
  },
  {
    "Unnamed: 0": 1293,
    "time": 1458000000,
    "open": 14.2667,
    "high": 14.598,
    "low": 14.1,
    "close": 14.5333,
    "volume": 80336310.0
  },
  {
    "Unnamed: 0": 1294,
    "time": 1458086400,
    "open": 14.556,
    "high": 14.8387,
    "low": 14.4533,
    "close": 14.8113,
    "volume": 45207405.0
  },
  {
    "Unnamed: 0": 1295,
    "time": 1458172800,
    "open": 14.8,
    "high": 15.2333,
    "low": 14.6267,
    "close": 15.21,
    "volume": 48334365.0
  },
  {
    "Unnamed: 0": 1296,
    "time": 1458259200,
    "open": 15.1333,
    "high": 15.632,
    "low": 15.1067,
    "close": 15.4733,
    "volume": 59588040.0
  },
  {
    "Unnamed: 0": 1297,
    "time": 1458518400,
    "open": 15.5333,
    "high": 15.992,
    "low": 15.516,
    "close": 15.9,
    "volume": 66283815.0
  },
  {
    "Unnamed: 0": 1298,
    "time": 1458604800,
    "open": 15.9,
    "high": 15.9327,
    "low": 15.5033,
    "close": 15.5333,
    "volume": 53471670.0
  },
  {
    "Unnamed: 0": 1299,
    "time": 1458691200,
    "open": 15.6333,
    "high": 15.68,
    "low": 14.6867,
    "close": 14.6893,
    "volume": 62026500.0
  },
  {
    "Unnamed: 0": 1300,
    "time": 1458777600,
    "open": 14.5127,
    "high": 15.2593,
    "low": 14.2987,
    "close": 15.22,
    "volume": 64368510.0
  },
  {
    "Unnamed: 0": 1301,
    "time": 1459123200,
    "open": 15.226,
    "high": 15.654,
    "low": 15.0,
    "close": 15.3333,
    "volume": 49788900.0
  },
  {
    "Unnamed: 0": 1302,
    "time": 1459209600,
    "open": 15.4333,
    "high": 15.492,
    "low": 15.022,
    "close": 15.3533,
    "volume": 51507480.0
  },
  {
    "Unnamed: 0": 1303,
    "time": 1459296000,
    "open": 15.46,
    "high": 15.7,
    "low": 15.1,
    "close": 15.1,
    "volume": 52204845.0
  },
  {
    "Unnamed: 0": 1304,
    "time": 1459382400,
    "open": 15.1333,
    "high": 15.828,
    "low": 15.0007,
    "close": 15.54,
    "volume": 103025805.0
  },
  {
    "Unnamed: 0": 1305,
    "time": 1459468800,
    "open": 15.6667,
    "high": 16.7493,
    "low": 15.318,
    "close": 15.83,
    "volume": 205378890.0
  },
  {
    "Unnamed: 0": 1306,
    "time": 1459728000,
    "open": 16.3333,
    "high": 16.808,
    "low": 15.7133,
    "close": 15.76,
    "volume": 169088775.0
  },
  {
    "Unnamed: 0": 1307,
    "time": 1459814400,
    "open": 15.8567,
    "high": 17.1667,
    "low": 15.7767,
    "close": 17.1667,
    "volume": 127513170.0
  },
  {
    "Unnamed: 0": 1308,
    "time": 1459900800,
    "open": 16.86,
    "high": 17.8493,
    "low": 16.8533,
    "close": 17.7533,
    "volume": 143856135.0
  },
  {
    "Unnamed: 0": 1309,
    "time": 1459987200,
    "open": 17.8667,
    "high": 17.956,
    "low": 16.9673,
    "close": 17.0647,
    "volume": 111640635.0
  },
  {
    "Unnamed: 0": 1310,
    "time": 1460073600,
    "open": 17.04,
    "high": 17.434,
    "low": 16.5347,
    "close": 16.6333,
    "volume": 92146575.0
  },
  {
    "Unnamed: 0": 1311,
    "time": 1460332800,
    "open": 16.7847,
    "high": 17.266,
    "low": 16.3533,
    "close": 16.62,
    "volume": 119938500.0
  },
  {
    "Unnamed: 0": 1312,
    "time": 1460419200,
    "open": 16.6333,
    "high": 16.8,
    "low": 16.242,
    "close": 16.49,
    "volume": 73495020.0
  },
  {
    "Unnamed: 0": 1313,
    "time": 1460505600,
    "open": 16.5667,
    "high": 17.0333,
    "low": 16.4887,
    "close": 16.9913,
    "volume": 63754965.0
  },
  {
    "Unnamed: 0": 1314,
    "time": 1460592000,
    "open": 16.8747,
    "high": 17.1227,
    "low": 16.7367,
    "close": 16.788,
    "volume": 53539065.0
  },
  {
    "Unnamed: 0": 1315,
    "time": 1460678400,
    "open": 16.8007,
    "high": 17.004,
    "low": 16.608,
    "close": 16.9267,
    "volume": 47150220.0
  },
  {
    "Unnamed: 0": 1316,
    "time": 1460937600,
    "open": 16.9,
    "high": 17.2207,
    "low": 16.7773,
    "close": 16.848,
    "volume": 56465895.0
  },
  {
    "Unnamed: 0": 1317,
    "time": 1461024000,
    "open": 17.0267,
    "high": 17.0393,
    "low": 16.0833,
    "close": 16.3333,
    "volume": 80956815.0
  },
  {
    "Unnamed: 0": 1318,
    "time": 1461110400,
    "open": 16.5193,
    "high": 16.9107,
    "low": 16.1,
    "close": 16.66,
    "volume": 67998930.0
  },
  {
    "Unnamed: 0": 1319,
    "time": 1461196800,
    "open": 16.6553,
    "high": 16.7313,
    "low": 16.4,
    "close": 16.4887,
    "volume": 36160305.0
  },
  {
    "Unnamed: 0": 1320,
    "time": 1461283200,
    "open": 16.5133,
    "high": 16.9333,
    "low": 16.3807,
    "close": 16.9233,
    "volume": 50184240.0
  },
  {
    "Unnamed: 0": 1321,
    "time": 1461542400,
    "open": 17.02,
    "high": 17.1587,
    "low": 16.7173,
    "close": 16.7667,
    "volume": 46018590.0
  },
  {
    "Unnamed: 0": 1322,
    "time": 1461628800,
    "open": 16.8007,
    "high": 17.0487,
    "low": 16.626,
    "close": 16.772,
    "volume": 41643750.0
  },
  {
    "Unnamed: 0": 1323,
    "time": 1461715200,
    "open": 16.83,
    "high": 17.0,
    "low": 16.6267,
    "close": 16.7853,
    "volume": 41368650.0
  },
  {
    "Unnamed: 0": 1324,
    "time": 1461801600,
    "open": 16.696,
    "high": 16.8953,
    "low": 16.496,
    "close": 16.5433,
    "volume": 31875060.0
  },
  {
    "Unnamed: 0": 1325,
    "time": 1461888000,
    "open": 16.5167,
    "high": 16.666,
    "low": 15.854,
    "close": 15.9533,
    "volume": 67850040.0
  },
  {
    "Unnamed: 0": 1326,
    "time": 1462147200,
    "open": 16.1167,
    "high": 16.2127,
    "low": 15.6547,
    "close": 16.12,
    "volume": 48718935.0
  },
  {
    "Unnamed: 0": 1327,
    "time": 1462233600,
    "open": 15.9907,
    "high": 16.12,
    "low": 15.4207,
    "close": 15.4387,
    "volume": 54099555.0
  },
  {
    "Unnamed: 0": 1328,
    "time": 1462320000,
    "open": 15.3467,
    "high": 16.1753,
    "low": 14.6933,
    "close": 15.2333,
    "volume": 101952825.0
  },
  {
    "Unnamed: 0": 1329,
    "time": 1462406400,
    "open": 15.3647,
    "high": 15.6,
    "low": 13.986,
    "close": 14.0347,
    "volume": 140309865.0
  },
  {
    "Unnamed: 0": 1330,
    "time": 1462492800,
    "open": 14.0667,
    "high": 14.4247,
    "low": 13.874,
    "close": 14.3267,
    "volume": 74756025.0
  },
  {
    "Unnamed: 0": 1331,
    "time": 1462752000,
    "open": 14.4333,
    "high": 14.534,
    "low": 13.7867,
    "close": 13.8167,
    "volume": 62450460.0
  },
  {
    "Unnamed: 0": 1332,
    "time": 1462838400,
    "open": 14.026,
    "high": 14.0413,
    "low": 13.6667,
    "close": 13.88,
    "volume": 51794940.0
  },
  {
    "Unnamed: 0": 1333,
    "time": 1462924800,
    "open": 13.874,
    "high": 14.3653,
    "low": 13.7367,
    "close": 13.894,
    "volume": 61181340.0
  },
  {
    "Unnamed: 0": 1334,
    "time": 1463011200,
    "open": 13.9933,
    "high": 14.1533,
    "low": 13.5767,
    "close": 13.7767,
    "volume": 46360335.0
  },
  {
    "Unnamed: 0": 1335,
    "time": 1463097600,
    "open": 13.7793,
    "high": 14.08,
    "low": 13.7473,
    "close": 13.82,
    "volume": 35990505.0
  },
  {
    "Unnamed: 0": 1336,
    "time": 1463356800,
    "open": 13.9327,
    "high": 14.21,
    "low": 13.8587,
    "close": 13.888,
    "volume": 37083990.0
  },
  {
    "Unnamed: 0": 1337,
    "time": 1463443200,
    "open": 13.9327,
    "high": 13.988,
    "low": 13.6013,
    "close": 13.6867,
    "volume": 34568325.0
  },
  {
    "Unnamed: 0": 1338,
    "time": 1463529600,
    "open": 13.902,
    "high": 14.354,
    "low": 13.2007,
    "close": 14.0333,
    "volume": 69813285.0
  },
  {
    "Unnamed: 0": 1339,
    "time": 1463616000,
    "open": 14.0467,
    "high": 14.7333,
    "low": 13.82,
    "close": 14.574,
    "volume": 86109435.0
  },
  {
    "Unnamed: 0": 1340,
    "time": 1463702400,
    "open": 14.7313,
    "high": 14.7313,
    "low": 14.194,
    "close": 14.6547,
    "volume": 113611050.0
  },
  {
    "Unnamed: 0": 1341,
    "time": 1463961600,
    "open": 14.726,
    "high": 14.84,
    "low": 14.38,
    "close": 14.38,
    "volume": 66618810.0
  },
  {
    "Unnamed: 0": 1342,
    "time": 1464048000,
    "open": 14.4993,
    "high": 14.5827,
    "low": 14.3453,
    "close": 14.53,
    "volume": 37793115.0
  },
  {
    "Unnamed: 0": 1343,
    "time": 1464134400,
    "open": 14.6327,
    "high": 14.7573,
    "low": 14.41,
    "close": 14.5933,
    "volume": 37445070.0
  },
  {
    "Unnamed: 0": 1344,
    "time": 1464220800,
    "open": 14.666,
    "high": 15.0327,
    "low": 14.6033,
    "close": 15.0327,
    "volume": 53304360.0
  },
  {
    "Unnamed: 0": 1345,
    "time": 1464307200,
    "open": 15.0667,
    "high": 15.0667,
    "low": 14.7167,
    "close": 14.8433,
    "volume": 47011290.0
  },
  {
    "Unnamed: 0": 1346,
    "time": 1464652800,
    "open": 14.926,
    "high": 14.9833,
    "low": 14.7667,
    "close": 14.8733,
    "volume": 31549200.0
  },
  {
    "Unnamed: 0": 1347,
    "time": 1464739200,
    "open": 14.8267,
    "high": 14.8267,
    "low": 14.4593,
    "close": 14.6,
    "volume": 38188845.0
  },
  {
    "Unnamed: 0": 1348,
    "time": 1464825600,
    "open": 14.632,
    "high": 14.7327,
    "low": 14.474,
    "close": 14.702,
    "volume": 24582015.0
  },
  {
    "Unnamed: 0": 1349,
    "time": 1464912000,
    "open": 14.7,
    "high": 14.796,
    "low": 14.534,
    "close": 14.5673,
    "volume": 28329450.0
  },
  {
    "Unnamed: 0": 1350,
    "time": 1465171200,
    "open": 14.6047,
    "high": 14.7267,
    "low": 14.3633,
    "close": 14.7053,
    "volume": 28419060.0
  },
  {
    "Unnamed: 0": 1351,
    "time": 1465257600,
    "open": 14.748,
    "high": 15.6293,
    "low": 14.7327,
    "close": 15.5127,
    "volume": 80287470.0
  },
  {
    "Unnamed: 0": 1352,
    "time": 1465344000,
    "open": 15.5333,
    "high": 16.0567,
    "low": 15.4567,
    "close": 15.7233,
    "volume": 76060455.0
  },
  {
    "Unnamed: 0": 1353,
    "time": 1465430400,
    "open": 15.6467,
    "high": 15.6887,
    "low": 15.07,
    "close": 15.09,
    "volume": 58262070.0
  },
  {
    "Unnamed: 0": 1354,
    "time": 1465516800,
    "open": 14.8733,
    "high": 15.2667,
    "low": 14.4787,
    "close": 14.674,
    "volume": 78597060.0
  },
  {
    "Unnamed: 0": 1355,
    "time": 1465776000,
    "open": 14.5533,
    "high": 15.0513,
    "low": 14.4653,
    "close": 14.5133,
    "volume": 53577120.0
  },
  {
    "Unnamed: 0": 1356,
    "time": 1465862400,
    "open": 14.582,
    "high": 14.8133,
    "low": 14.1687,
    "close": 14.28,
    "volume": 44983245.0
  },
  {
    "Unnamed: 0": 1357,
    "time": 1465948800,
    "open": 14.4333,
    "high": 14.7933,
    "low": 14.342,
    "close": 14.532,
    "volume": 36963330.0
  },
  {
    "Unnamed: 0": 1358,
    "time": 1466035200,
    "open": 14.51,
    "high": 14.658,
    "low": 14.2333,
    "close": 14.5333,
    "volume": 31423200.0
  },
  {
    "Unnamed: 0": 1359,
    "time": 1466121600,
    "open": 14.5353,
    "high": 14.666,
    "low": 14.3,
    "close": 14.33,
    "volume": 38441865.0
  },
  {
    "Unnamed: 0": 1360,
    "time": 1466380800,
    "open": 14.5,
    "high": 14.9167,
    "low": 14.5,
    "close": 14.696,
    "volume": 44990895.0
  },
  {
    "Unnamed: 0": 1361,
    "time": 1466467200,
    "open": 14.7667,
    "high": 14.838,
    "low": 12.608,
    "close": 12.8533,
    "volume": 41360595.0
  },
  {
    "Unnamed: 0": 1362,
    "time": 1466553600,
    "open": 14.0,
    "high": 14.0,
    "low": 12.8807,
    "close": 13.1867,
    "volume": 288062460.0
  },
  {
    "Unnamed: 0": 1363,
    "time": 1466640000,
    "open": 13.196,
    "high": 13.196,
    "low": 12.8087,
    "close": 13.0,
    "volume": 122422515.0
  },
  {
    "Unnamed: 0": 1364,
    "time": 1466726400,
    "open": 12.96,
    "high": 13.008,
    "low": 12.476,
    "close": 12.7333,
    "volume": 83003595.0
  },
  {
    "Unnamed: 0": 1365,
    "time": 1466985600,
    "open": 12.9067,
    "high": 13.254,
    "low": 12.5247,
    "close": 13.22,
    "volume": 90248895.0
  },
  {
    "Unnamed: 0": 1366,
    "time": 1467072000,
    "open": 13.27,
    "high": 13.6033,
    "low": 13.2633,
    "close": 13.4527,
    "volume": 69636630.0
  },
  {
    "Unnamed: 0": 1367,
    "time": 1467158400,
    "open": 13.5467,
    "high": 14.1187,
    "low": 13.5333,
    "close": 14.0167,
    "volume": 70308465.0
  },
  {
    "Unnamed: 0": 1368,
    "time": 1467244800,
    "open": 14.0827,
    "high": 14.2373,
    "low": 13.668,
    "close": 13.7333,
    "volume": 56418435.0
  },
  {
    "Unnamed: 0": 1369,
    "time": 1467331200,
    "open": 13.6393,
    "high": 14.5493,
    "low": 13.5967,
    "close": 14.4133,
    "volume": 63605955.0
  },
  {
    "Unnamed: 0": 1370,
    "time": 1467676800,
    "open": 14.0367,
    "high": 14.3033,
    "low": 13.7,
    "close": 14.0933,
    "volume": 64103865.0
  },
  {
    "Unnamed: 0": 1371,
    "time": 1467763200,
    "open": 13.9587,
    "high": 14.3487,
    "low": 13.9327,
    "close": 14.2433,
    "volume": 56001630.0
  },
  {
    "Unnamed: 0": 1372,
    "time": 1467849600,
    "open": 14.2867,
    "high": 14.5413,
    "low": 14.1667,
    "close": 14.4,
    "volume": 41651820.0
  },
  {
    "Unnamed: 0": 1373,
    "time": 1467936000,
    "open": 14.3667,
    "high": 14.654,
    "low": 14.3,
    "close": 14.4,
    "volume": 45595800.0
  },
  {
    "Unnamed: 0": 1374,
    "time": 1468195200,
    "open": 14.5633,
    "high": 15.1187,
    "low": 14.5633,
    "close": 14.82,
    "volume": 66368370.0
  },
  {
    "Unnamed: 0": 1375,
    "time": 1468281600,
    "open": 14.792,
    "high": 15.1667,
    "low": 14.7667,
    "close": 14.9667,
    "volume": 56701455.0
  },
  {
    "Unnamed: 0": 1376,
    "time": 1468368000,
    "open": 15.0,
    "high": 15.0667,
    "low": 14.686,
    "close": 14.8667,
    "volume": 44640195.0
  },
  {
    "Unnamed: 0": 1377,
    "time": 1468454400,
    "open": 14.9,
    "high": 15.0667,
    "low": 14.7367,
    "close": 14.7687,
    "volume": 32683545.0
  },
  {
    "Unnamed: 0": 1378,
    "time": 1468540800,
    "open": 14.8333,
    "high": 14.85,
    "low": 14.6067,
    "close": 14.6067,
    "volume": 28054815.0
  },
  {
    "Unnamed: 0": 1379,
    "time": 1468800000,
    "open": 14.6667,
    "high": 15.1393,
    "low": 14.5533,
    "close": 15.0433,
    "volume": 43574475.0
  },
  {
    "Unnamed: 0": 1380,
    "time": 1468886400,
    "open": 15.034,
    "high": 15.2733,
    "low": 14.9833,
    "close": 15.08,
    "volume": 36414315.0
  },
  {
    "Unnamed: 0": 1381,
    "time": 1468972800,
    "open": 15.1347,
    "high": 15.32,
    "low": 15.0,
    "close": 15.28,
    "volume": 31636800.0
  },
  {
    "Unnamed: 0": 1382,
    "time": 1469059200,
    "open": 15.342,
    "high": 15.3667,
    "low": 14.6067,
    "close": 14.6667,
    "volume": 55197015.0
  },
  {
    "Unnamed: 0": 1383,
    "time": 1469145600,
    "open": 14.714,
    "high": 14.9667,
    "low": 14.592,
    "close": 14.7933,
    "volume": 32939685.0
  },
  {
    "Unnamed: 0": 1384,
    "time": 1469404800,
    "open": 14.8333,
    "high": 15.426,
    "low": 14.758,
    "close": 15.3333,
    "volume": 57810465.0
  },
  {
    "Unnamed: 0": 1385,
    "time": 1469491200,
    "open": 15.4,
    "high": 15.4,
    "low": 15.02,
    "close": 15.2833,
    "volume": 39602580.0
  },
  {
    "Unnamed: 0": 1386,
    "time": 1469577600,
    "open": 15.31,
    "high": 15.5573,
    "low": 15.128,
    "close": 15.22,
    "volume": 35585460.0
  },
  {
    "Unnamed: 0": 1387,
    "time": 1469664000,
    "open": 15.2607,
    "high": 15.3853,
    "low": 15.1067,
    "close": 15.3853,
    "volume": 29429970.0
  },
  {
    "Unnamed: 0": 1388,
    "time": 1469750400,
    "open": 15.3507,
    "high": 15.6853,
    "low": 15.3333,
    "close": 15.6147,
    "volume": 38264985.0
  },
  {
    "Unnamed: 0": 1389,
    "time": 1470009600,
    "open": 15.6907,
    "high": 15.7753,
    "low": 15.276,
    "close": 15.4113,
    "volume": 51807975.0
  },
  {
    "Unnamed: 0": 1390,
    "time": 1470096000,
    "open": 15.3453,
    "high": 15.3453,
    "low": 14.76,
    "close": 15.1333,
    "volume": 48089565.0
  },
  {
    "Unnamed: 0": 1391,
    "time": 1470182400,
    "open": 15.1167,
    "high": 15.5333,
    "low": 14.4333,
    "close": 14.94,
    "volume": 49846905.0
  },
  {
    "Unnamed: 0": 1392,
    "time": 1470268800,
    "open": 15.2,
    "high": 15.3907,
    "low": 14.8033,
    "close": 15.3367,
    "volume": 52533225.0
  },
  {
    "Unnamed: 0": 1393,
    "time": 1470355200,
    "open": 15.3187,
    "high": 15.4667,
    "low": 15.15,
    "close": 15.1653,
    "volume": 38675430.0
  },
  {
    "Unnamed: 0": 1394,
    "time": 1470614400,
    "open": 15.1653,
    "high": 15.3067,
    "low": 15.0667,
    "close": 15.1,
    "volume": 27615555.0
  },
  {
    "Unnamed: 0": 1395,
    "time": 1470700800,
    "open": 15.02,
    "high": 15.436,
    "low": 15.0,
    "close": 15.2333,
    "volume": 26310885.0
  },
  {
    "Unnamed: 0": 1396,
    "time": 1470787200,
    "open": 15.2953,
    "high": 15.3247,
    "low": 14.9747,
    "close": 15.0667,
    "volume": 28483890.0
  },
  {
    "Unnamed: 0": 1397,
    "time": 1470873600,
    "open": 15.0727,
    "high": 15.1713,
    "low": 14.894,
    "close": 15.0,
    "volume": 24076710.0
  },
  {
    "Unnamed: 0": 1398,
    "time": 1470960000,
    "open": 14.9993,
    "high": 15.11,
    "low": 14.936,
    "close": 15.0393,
    "volume": 20300850.0
  },
  {
    "Unnamed: 0": 1399,
    "time": 1471219200,
    "open": 15.0667,
    "high": 15.3,
    "low": 14.9867,
    "close": 15.0007,
    "volume": 25273980.0
  },
  {
    "Unnamed: 0": 1400,
    "time": 1471305600,
    "open": 14.9813,
    "high": 15.146,
    "low": 14.8887,
    "close": 14.9067,
    "volume": 26379855.0
  },
  {
    "Unnamed: 0": 1401,
    "time": 1471392000,
    "open": 14.7053,
    "high": 14.9887,
    "low": 14.7053,
    "close": 14.892,
    "volume": 21790455.0
  },
  {
    "Unnamed: 0": 1402,
    "time": 1471478400,
    "open": 14.8827,
    "high": 15.044,
    "low": 14.8193,
    "close": 14.8667,
    "volume": 20870070.0
  },
  {
    "Unnamed: 0": 1403,
    "time": 1471564800,
    "open": 14.8667,
    "high": 15.0133,
    "low": 14.8353,
    "close": 15.0,
    "volume": 19653315.0
  },
  {
    "Unnamed: 0": 1404,
    "time": 1471824000,
    "open": 15.0067,
    "high": 15.0527,
    "low": 14.8453,
    "close": 14.87,
    "volume": 26019900.0
  },
  {
    "Unnamed: 0": 1405,
    "time": 1471910400,
    "open": 14.9067,
    "high": 15.2327,
    "low": 14.8533,
    "close": 15.1087,
    "volume": 63281610.0
  },
  {
    "Unnamed: 0": 1406,
    "time": 1471996800,
    "open": 15.1067,
    "high": 15.1433,
    "low": 14.8147,
    "close": 14.8147,
    "volume": 30888090.0
  },
  {
    "Unnamed: 0": 1407,
    "time": 1472083200,
    "open": 14.802,
    "high": 14.9327,
    "low": 14.7167,
    "close": 14.7327,
    "volume": 21926385.0
  },
  {
    "Unnamed: 0": 1408,
    "time": 1472169600,
    "open": 14.7567,
    "high": 14.8633,
    "low": 14.588,
    "close": 14.634,
    "volume": 28345545.0
  },
  {
    "Unnamed: 0": 1409,
    "time": 1472428800,
    "open": 14.6,
    "high": 14.6933,
    "low": 14.3333,
    "close": 14.3413,
    "volume": 41806380.0
  },
  {
    "Unnamed: 0": 1410,
    "time": 1472515200,
    "open": 14.3667,
    "high": 14.4073,
    "low": 14.0347,
    "close": 14.064,
    "volume": 39825960.0
  },
  {
    "Unnamed: 0": 1411,
    "time": 1472601600,
    "open": 14.066,
    "high": 14.1733,
    "low": 13.91,
    "close": 14.1,
    "volume": 40418205.0
  },
  {
    "Unnamed: 0": 1412,
    "time": 1472688000,
    "open": 14.1647,
    "high": 14.206,
    "low": 13.35,
    "close": 13.4167,
    "volume": 102308160.0
  },
  {
    "Unnamed: 0": 1413,
    "time": 1472774400,
    "open": 13.5233,
    "high": 13.5467,
    "low": 13.08,
    "close": 13.22,
    "volume": 74876685.0
  },
  {
    "Unnamed: 0": 1414,
    "time": 1473120000,
    "open": 13.3333,
    "high": 13.5667,
    "low": 13.2513,
    "close": 13.5493,
    "volume": 54042450.0
  },
  {
    "Unnamed: 0": 1415,
    "time": 1473206400,
    "open": 13.5627,
    "high": 13.7667,
    "low": 13.3807,
    "close": 13.4633,
    "volume": 44694975.0
  },
  {
    "Unnamed: 0": 1416,
    "time": 1473292800,
    "open": 13.4953,
    "high": 13.4993,
    "low": 13.0907,
    "close": 13.1767,
    "volume": 41787750.0
  },
  {
    "Unnamed: 0": 1417,
    "time": 1473379200,
    "open": 13.144,
    "high": 13.3487,
    "low": 12.9133,
    "close": 12.95,
    "volume": 48325905.0
  },
  {
    "Unnamed: 0": 1418,
    "time": 1473638400,
    "open": 12.8667,
    "high": 13.4247,
    "low": 12.812,
    "close": 13.2567,
    "volume": 45839700.0
  },
  {
    "Unnamed: 0": 1419,
    "time": 1473724800,
    "open": 13.2113,
    "high": 13.25,
    "low": 12.8967,
    "close": 12.9807,
    "volume": 44783100.0
  },
  {
    "Unnamed: 0": 1420,
    "time": 1473811200,
    "open": 13.0233,
    "high": 13.1953,
    "low": 12.99,
    "close": 13.0667,
    "volume": 28667115.0
  },
  {
    "Unnamed: 0": 1421,
    "time": 1473897600,
    "open": 13.1247,
    "high": 13.5013,
    "low": 13.0333,
    "close": 13.3507,
    "volume": 36054000.0
  },
  {
    "Unnamed: 0": 1422,
    "time": 1473984000,
    "open": 13.354,
    "high": 13.7167,
    "low": 13.258,
    "close": 13.694,
    "volume": 38842110.0
  },
  {
    "Unnamed: 0": 1423,
    "time": 1474243200,
    "open": 13.7007,
    "high": 13.962,
    "low": 13.6667,
    "close": 13.766,
    "volume": 28640355.0
  },
  {
    "Unnamed: 0": 1424,
    "time": 1474329600,
    "open": 13.756,
    "high": 13.85,
    "low": 13.594,
    "close": 13.6233,
    "volume": 24932340.0
  },
  {
    "Unnamed: 0": 1425,
    "time": 1474416000,
    "open": 13.6667,
    "high": 13.8,
    "low": 13.4373,
    "close": 13.712,
    "volume": 31800480.0
  },
  {
    "Unnamed: 0": 1426,
    "time": 1474502400,
    "open": 13.7093,
    "high": 13.8187,
    "low": 13.5333,
    "close": 13.6733,
    "volume": 29451975.0
  },
  {
    "Unnamed: 0": 1427,
    "time": 1474588800,
    "open": 13.716,
    "high": 14.012,
    "low": 13.6667,
    "close": 13.8667,
    "volume": 33538245.0
  },
  {
    "Unnamed: 0": 1428,
    "time": 1474848000,
    "open": 13.7833,
    "high": 14.0667,
    "low": 13.7047,
    "close": 13.93,
    "volume": 28243755.0
  },
  {
    "Unnamed: 0": 1429,
    "time": 1474934400,
    "open": 13.9533,
    "high": 14.0133,
    "low": 13.64,
    "close": 13.7253,
    "volume": 39862860.0
  },
  {
    "Unnamed: 0": 1430,
    "time": 1475020800,
    "open": 13.7553,
    "high": 13.8833,
    "low": 13.6333,
    "close": 13.76,
    "volume": 27330960.0
  },
  {
    "Unnamed: 0": 1431,
    "time": 1475107200,
    "open": 13.7353,
    "high": 13.822,
    "low": 13.35,
    "close": 13.3767,
    "volume": 35370465.0
  },
  {
    "Unnamed: 0": 1432,
    "time": 1475193600,
    "open": 13.38,
    "high": 13.6653,
    "low": 13.3033,
    "close": 13.6,
    "volume": 33940980.0
  },
  {
    "Unnamed: 0": 1433,
    "time": 1475452800,
    "open": 13.7933,
    "high": 14.378,
    "low": 13.602,
    "close": 14.2333,
    "volume": 80238360.0
  },
  {
    "Unnamed: 0": 1434,
    "time": 1475539200,
    "open": 14.232,
    "high": 14.3,
    "low": 13.9213,
    "close": 14.1333,
    "volume": 45776940.0
  },
  {
    "Unnamed: 0": 1435,
    "time": 1475625600,
    "open": 14.0927,
    "high": 14.21,
    "low": 13.8747,
    "close": 13.94,
    "volume": 23797215.0
  },
  {
    "Unnamed: 0": 1436,
    "time": 1475712000,
    "open": 13.9107,
    "high": 13.9107,
    "low": 13.3473,
    "close": 13.3773,
    "volume": 61862850.0
  },
  {
    "Unnamed: 0": 1437,
    "time": 1475798400,
    "open": 13.3973,
    "high": 13.4633,
    "low": 13.0533,
    "close": 13.1133,
    "volume": 44352930.0
  },
  {
    "Unnamed: 0": 1438,
    "time": 1476057600,
    "open": 13.4067,
    "high": 13.6093,
    "low": 13.1073,
    "close": 13.4133,
    "volume": 43733445.0
  },
  {
    "Unnamed: 0": 1439,
    "time": 1476144000,
    "open": 13.4133,
    "high": 13.48,
    "low": 13.2207,
    "close": 13.35,
    "volume": 30339060.0
  },
  {
    "Unnamed: 0": 1440,
    "time": 1476230400,
    "open": 13.3367,
    "high": 13.592,
    "low": 13.32,
    "close": 13.426,
    "volume": 24088650.0
  },
  {
    "Unnamed: 0": 1441,
    "time": 1476316800,
    "open": 13.334,
    "high": 13.3933,
    "low": 13.1367,
    "close": 13.3653,
    "volume": 28215435.0
  },
  {
    "Unnamed: 0": 1442,
    "time": 1476403200,
    "open": 13.4013,
    "high": 13.4333,
    "low": 13.0867,
    "close": 13.1327,
    "volume": 57088020.0
  },
  {
    "Unnamed: 0": 1443,
    "time": 1476662400,
    "open": 13.114,
    "high": 13.2307,
    "low": 12.8,
    "close": 12.9833,
    "volume": 59920515.0
  },
  {
    "Unnamed: 0": 1444,
    "time": 1476748800,
    "open": 13.0513,
    "high": 13.298,
    "low": 12.884,
    "close": 13.2867,
    "volume": 77545620.0
  },
  {
    "Unnamed: 0": 1445,
    "time": 1476835200,
    "open": 13.2867,
    "high": 13.7773,
    "low": 13.178,
    "close": 13.6333,
    "volume": 94281555.0
  },
  {
    "Unnamed: 0": 1446,
    "time": 1476921600,
    "open": 13.4667,
    "high": 13.5493,
    "low": 13.1367,
    "close": 13.2367,
    "volume": 65298930.0
  },
  {
    "Unnamed: 0": 1447,
    "time": 1477008000,
    "open": 13.2487,
    "high": 13.438,
    "low": 13.1493,
    "close": 13.3507,
    "volume": 37628655.0
  },
  {
    "Unnamed: 0": 1448,
    "time": 1477267200,
    "open": 13.3667,
    "high": 13.5967,
    "low": 13.35,
    "close": 13.4673,
    "volume": 35458005.0
  },
  {
    "Unnamed: 0": 1449,
    "time": 1477353600,
    "open": 13.522,
    "high": 13.646,
    "low": 13.4047,
    "close": 13.42,
    "volume": 28966155.0
  },
  {
    "Unnamed: 0": 1450,
    "time": 1477440000,
    "open": 13.4707,
    "high": 14.432,
    "low": 13.3333,
    "close": 14.0667,
    "volume": 75116040.0
  },
  {
    "Unnamed: 0": 1451,
    "time": 1477526400,
    "open": 14.0367,
    "high": 14.2467,
    "low": 13.4433,
    "close": 13.5533,
    "volume": 175683330.0
  },
  {
    "Unnamed: 0": 1452,
    "time": 1477612800,
    "open": 13.6007,
    "high": 13.688,
    "low": 13.322,
    "close": 13.366,
    "volume": 57461385.0
  },
  {
    "Unnamed: 0": 1453,
    "time": 1477872000,
    "open": 13.3333,
    "high": 13.556,
    "low": 13.054,
    "close": 13.1667,
    "volume": 56721510.0
  },
  {
    "Unnamed: 0": 1454,
    "time": 1477958400,
    "open": 13.192,
    "high": 13.2667,
    "low": 12.5007,
    "close": 12.5893,
    "volume": 89997060.0
  },
  {
    "Unnamed: 0": 1455,
    "time": 1478044800,
    "open": 12.6487,
    "high": 12.8467,
    "low": 12.4147,
    "close": 12.4827,
    "volume": 54515745.0
  },
  {
    "Unnamed: 0": 1456,
    "time": 1478131200,
    "open": 12.5307,
    "high": 12.7647,
    "low": 12.4693,
    "close": 12.5,
    "volume": 32900445.0
  },
  {
    "Unnamed: 0": 1457,
    "time": 1478217600,
    "open": 12.4747,
    "high": 12.8973,
    "low": 12.3973,
    "close": 12.7467,
    "volume": 65781930.0
  },
  {
    "Unnamed: 0": 1458,
    "time": 1478476800,
    "open": 12.93,
    "high": 12.996,
    "low": 12.67,
    "close": 12.89,
    "volume": 50097405.0
  },
  {
    "Unnamed: 0": 1459,
    "time": 1478563200,
    "open": 12.8893,
    "high": 13.166,
    "low": 12.7507,
    "close": 13.0333,
    "volume": 42242490.0
  },
  {
    "Unnamed: 0": 1460,
    "time": 1478649600,
    "open": 12.232,
    "high": 12.8,
    "low": 12.1333,
    "close": 12.678,
    "volume": 103742010.0
  },
  {
    "Unnamed: 0": 1461,
    "time": 1478736000,
    "open": 12.8,
    "high": 12.8733,
    "low": 12.028,
    "close": 12.3667,
    "volume": 84858330.0
  },
  {
    "Unnamed: 0": 1462,
    "time": 1478822400,
    "open": 12.306,
    "high": 12.592,
    "low": 12.2,
    "close": 12.57,
    "volume": 51611205.0
  },
  {
    "Unnamed: 0": 1463,
    "time": 1479081600,
    "open": 12.648,
    "high": 12.648,
    "low": 11.8793,
    "close": 12.1233,
    "volume": 85608450.0
  },
  {
    "Unnamed: 0": 1464,
    "time": 1479168000,
    "open": 12.2167,
    "high": 12.4287,
    "low": 12.1253,
    "close": 12.2787,
    "volume": 50682225.0
  },
  {
    "Unnamed: 0": 1465,
    "time": 1479254400,
    "open": 12.2433,
    "high": 12.3153,
    "low": 12.0807,
    "close": 12.2167,
    "volume": 41321985.0
  },
  {
    "Unnamed: 0": 1466,
    "time": 1479340800,
    "open": 12.2773,
    "high": 12.9,
    "low": 12.1407,
    "close": 12.6467,
    "volume": 57600180.0
  },
  {
    "Unnamed: 0": 1467,
    "time": 1479427200,
    "open": 12.634,
    "high": 12.8667,
    "low": 12.3273,
    "close": 12.3273,
    "volume": 67142955.0
  },
  {
    "Unnamed: 0": 1468,
    "time": 1479686400,
    "open": 12.3467,
    "high": 12.5927,
    "low": 12.294,
    "close": 12.312,
    "volume": 57124485.0
  },
  {
    "Unnamed: 0": 1469,
    "time": 1479772800,
    "open": 12.3853,
    "high": 12.7647,
    "low": 12.2473,
    "close": 12.7633,
    "volume": 73593240.0
  },
  {
    "Unnamed: 0": 1470,
    "time": 1479859200,
    "open": 12.74,
    "high": 13.0433,
    "low": 12.6,
    "close": 12.8667,
    "volume": 62876265.0
  },
  {
    "Unnamed: 0": 1471,
    "time": 1480032000,
    "open": 12.9,
    "high": 13.1493,
    "low": 12.9,
    "close": 13.11,
    "volume": 30619665.0
  },
  {
    "Unnamed: 0": 1472,
    "time": 1480291200,
    "open": 13.0233,
    "high": 13.29,
    "low": 12.97,
    "close": 13.0847,
    "volume": 58714410.0
  },
  {
    "Unnamed: 0": 1473,
    "time": 1480377600,
    "open": 13.068,
    "high": 13.1333,
    "low": 12.6333,
    "close": 12.6347,
    "volume": 57520620.0
  },
  {
    "Unnamed: 0": 1474,
    "time": 1480464000,
    "open": 12.7273,
    "high": 12.8,
    "low": 12.5,
    "close": 12.6233,
    "volume": 45849390.0
  },
  {
    "Unnamed: 0": 1475,
    "time": 1480550400,
    "open": 12.5927,
    "high": 12.6307,
    "low": 12.0667,
    "close": 12.1533,
    "volume": 65228070.0
  },
  {
    "Unnamed: 0": 1476,
    "time": 1480636800,
    "open": 12.1407,
    "high": 12.3253,
    "low": 12.0,
    "close": 12.1,
    "volume": 51604950.0
  },
  {
    "Unnamed: 0": 1477,
    "time": 1480896000,
    "open": 12.1673,
    "high": 12.5927,
    "low": 12.1667,
    "close": 12.4667,
    "volume": 50948565.0
  },
  {
    "Unnamed: 0": 1478,
    "time": 1480982400,
    "open": 12.4993,
    "high": 12.5067,
    "low": 12.1787,
    "close": 12.3833,
    "volume": 44166465.0
  },
  {
    "Unnamed: 0": 1479,
    "time": 1481068800,
    "open": 12.43,
    "high": 12.8933,
    "low": 12.3333,
    "close": 12.8167,
    "volume": 71439045.0
  },
  {
    "Unnamed: 0": 1480,
    "time": 1481155200,
    "open": 12.8427,
    "high": 12.8667,
    "low": 12.636,
    "close": 12.8,
    "volume": 40960065.0
  },
  {
    "Unnamed: 0": 1481,
    "time": 1481241600,
    "open": 12.7807,
    "high": 12.9227,
    "low": 12.6833,
    "close": 12.7833,
    "volume": 33890505.0
  },
  {
    "Unnamed: 0": 1482,
    "time": 1481500800,
    "open": 12.7867,
    "high": 12.9613,
    "low": 12.686,
    "close": 12.8287,
    "volume": 31229640.0
  },
  {
    "Unnamed: 0": 1483,
    "time": 1481587200,
    "open": 12.87,
    "high": 13.4187,
    "low": 12.8667,
    "close": 13.2133,
    "volume": 89130030.0
  },
  {
    "Unnamed: 0": 1484,
    "time": 1481673600,
    "open": 13.23,
    "high": 13.5333,
    "low": 13.1173,
    "close": 13.3,
    "volume": 54654495.0
  },
  {
    "Unnamed: 0": 1485,
    "time": 1481760000,
    "open": 13.2493,
    "high": 13.3827,
    "low": 13.1593,
    "close": 13.1653,
    "volume": 41365305.0
  },
  {
    "Unnamed: 0": 1486,
    "time": 1481846400,
    "open": 13.2027,
    "high": 13.506,
    "low": 13.1733,
    "close": 13.4933,
    "volume": 49030395.0
  },
  {
    "Unnamed: 0": 1487,
    "time": 1482105600,
    "open": 13.51,
    "high": 13.63,
    "low": 13.3227,
    "close": 13.4967,
    "volume": 45378420.0
  },
  {
    "Unnamed: 0": 1488,
    "time": 1482192000,
    "open": 13.5593,
    "high": 13.9333,
    "low": 13.5,
    "close": 13.9193,
    "volume": 62280810.0
  },
  {
    "Unnamed: 0": 1489,
    "time": 1482278400,
    "open": 13.8893,
    "high": 14.1487,
    "low": 13.8273,
    "close": 13.852,
    "volume": 69526095.0
  }
])
window.dloqqrvj.volumeSeries.setData([
  {
    "Unnamed: 0": 0,
    "time": 1277769600,
    "value": 277519500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1,
    "time": 1277856000,
    "value": 253039500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 2,
    "time": 1277942400,
    "value": 121461000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 3,
    "time": 1278028800,
    "value": 75871500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 4,
    "time": 1278374400,
    "value": 101664000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 5,
    "time": 1278460800,
    "value": 102645000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 6,
    "time": 1278547200,
    "value": 114526500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 7,
    "time": 1278633600,
    "value": 60061500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 8,
    "time": 1278892800,
    "value": 32487000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 9,
    "time": 1278979200,
    "value": 39439500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 10,
    "time": 1279065600,
    "value": 62097000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 11,
    "time": 1279152000,
    "value": 55222500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 12,
    "time": 1279238400,
    "value": 37939500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 13,
    "time": 1279497600,
    "value": 36303000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 14,
    "time": 1279584000,
    "value": 26229000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 15,
    "time": 1279670400,
    "value": 18214500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 16,
    "time": 1279756800,
    "value": 13924500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 17,
    "time": 1279843200,
    "value": 9603000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 18,
    "time": 1280102400,
    "value": 13416000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 19,
    "time": 1280188800,
    "value": 8658000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 20,
    "time": 1280275200,
    "value": 6801000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 21,
    "time": 1280361600,
    "value": 8734500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 22,
    "time": 1280448000,
    "value": 6258000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 23,
    "time": 1280707200,
    "value": 10417500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 24,
    "time": 1280793600,
    "value": 17827500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 25,
    "time": 1280880000,
    "value": 13594500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 26,
    "time": 1280966400,
    "value": 11722500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 27,
    "time": 1281052800,
    "value": 10542000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 28,
    "time": 1281312000,
    "value": 10684500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 29,
    "time": 1281398400,
    "value": 17506500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 30,
    "time": 1281484800,
    "value": 11340000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 31,
    "time": 1281571200,
    "value": 10168500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 32,
    "time": 1281657600,
    "value": 9385500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 33,
    "time": 1281916800,
    "value": 7186500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 34,
    "time": 1282003200,
    "value": 6597000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 35,
    "time": 1282089600,
    "value": 8905500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 36,
    "time": 1282176000,
    "value": 8290500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 37,
    "time": 1282262400,
    "value": 4381500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 38,
    "time": 1282521600,
    "value": 16048500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 39,
    "time": 1282608000,
    "value": 9973500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 40,
    "time": 1282694400,
    "value": 7372500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 41,
    "time": 1282780800,
    "value": 6189000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 42,
    "time": 1282867200,
    "value": 5628000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 43,
    "time": 1283126400,
    "value": 10831500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 44,
    "time": 1283212800,
    "value": 2956500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 45,
    "time": 1283299200,
    "value": 7306500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 46,
    "time": 1283385600,
    "value": 7159500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 47,
    "time": 1283472000,
    "value": 6402000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 48,
    "time": 1283817600,
    "value": 3612000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 49,
    "time": 1283904000,
    "value": 4281000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 50,
    "time": 1283990400,
    "value": 5586000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 51,
    "time": 1284076800,
    "value": 5706000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 52,
    "time": 1284336000,
    "value": 5361000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 53,
    "time": 1284422400,
    "value": 9564000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 54,
    "time": 1284508800,
    "value": 9990000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 55,
    "time": 1284595200,
    "value": 38347500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 56,
    "time": 1284681600,
    "value": 17478000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 57,
    "time": 1284940800,
    "value": 13968000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 58,
    "time": 1285027200,
    "value": 11749500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 59,
    "time": 1285113600,
    "value": 13227000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 60,
    "time": 1285200000,
    "value": 9856500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 61,
    "time": 1285286400,
    "value": 8590500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 62,
    "time": 1285545600,
    "value": 6181500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 63,
    "time": 1285632000,
    "value": 17905500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 64,
    "time": 1285718400,
    "value": 27925500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 65,
    "time": 1285804800,
    "value": 31186500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 66,
    "time": 1285891200,
    "value": 7783500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 67,
    "time": 1286150400,
    "value": 9444000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 68,
    "time": 1286236800,
    "value": 4914000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 69,
    "time": 1286323200,
    "value": 4617000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 70,
    "time": 1286409600,
    "value": 2064000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 71,
    "time": 1286496000,
    "value": 3973500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 72,
    "time": 1286755200,
    "value": 2497500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 73,
    "time": 1286841600,
    "value": 3405000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 74,
    "time": 1286928000,
    "value": 4728000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 75,
    "time": 1287014400,
    "value": 4314000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 76,
    "time": 1287100800,
    "value": 4189500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 77,
    "time": 1287360000,
    "value": 2374500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 78,
    "time": 1287446400,
    "value": 3601500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 79,
    "time": 1287532800,
    "value": 4608000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 80,
    "time": 1287619200,
    "value": 6166500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 81,
    "time": 1287705600,
    "value": 2374500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 82,
    "time": 1287964800,
    "value": 1737000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 83,
    "time": 1288051200,
    "value": 9744000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 84,
    "time": 1288137600,
    "value": 0.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 85,
    "time": 1294272000,
    "value": 28846500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 86,
    "time": 1294358400,
    "value": 33460500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 87,
    "time": 1294617600,
    "value": 19849500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 88,
    "time": 1294704000,
    "value": 25282500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 89,
    "time": 1294790400,
    "value": 13564500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 90,
    "time": 1294876800,
    "value": 10503000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 91,
    "time": 1294963200,
    "value": 17412000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 92,
    "time": 1295308800,
    "value": 23950500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 93,
    "time": 1295395200,
    "value": 35040000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 94,
    "time": 1295481600,
    "value": 33759000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 95,
    "time": 1295568000,
    "value": 18036000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 96,
    "time": 1295827200,
    "value": 24352500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 97,
    "time": 1295913600,
    "value": 18924000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 98,
    "time": 1296000000,
    "value": 16050000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 99,
    "time": 1296086400,
    "value": 12790500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 100,
    "time": 1296172800,
    "value": 15490500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 101,
    "time": 1296432000,
    "value": 11974500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 102,
    "time": 1296518400,
    "value": 10473000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 103,
    "time": 1296604800,
    "value": 8454000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 104,
    "time": 1296691200,
    "value": 7540500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 105,
    "time": 1296777600,
    "value": 8067000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 106,
    "time": 1297036800,
    "value": 13209000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 107,
    "time": 1297123200,
    "value": 51768000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 108,
    "time": 1297209600,
    "value": 37779000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 109,
    "time": 1297296000,
    "value": 12324000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 110,
    "time": 1297382400,
    "value": 9424500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 111,
    "time": 1297641600,
    "value": 18984000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 112,
    "time": 1297728000,
    "value": 14146500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 113,
    "time": 1297814400,
    "value": 60928500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 114,
    "time": 1297900800,
    "value": 38383500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 115,
    "time": 1297987200,
    "value": 35118000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 116,
    "time": 1298332800,
    "value": 30369000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 117,
    "time": 1298419200,
    "value": 23451000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 118,
    "time": 1298505600,
    "value": 15372000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 119,
    "time": 1298592000,
    "value": 19941000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 120,
    "time": 1298851200,
    "value": 15580500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 121,
    "time": 1298937600,
    "value": 16422000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 122,
    "time": 1299024000,
    "value": 9826500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 123,
    "time": 1299110400,
    "value": 9478500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 124,
    "time": 1299196800,
    "value": 22677000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 125,
    "time": 1299456000,
    "value": 30210000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 126,
    "time": 1299542400,
    "value": 20715000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 127,
    "time": 1299628800,
    "value": 13692000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 128,
    "time": 1299715200,
    "value": 14049000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 129,
    "time": 1299801600,
    "value": 13821000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 130,
    "time": 1300060800,
    "value": 17205000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 131,
    "time": 1300147200,
    "value": 19534500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 132,
    "time": 1300233600,
    "value": 17208000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 133,
    "time": 1300320000,
    "value": 12612000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 134,
    "time": 1300406400,
    "value": 10195500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 135,
    "time": 1300665600,
    "value": 6057000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 136,
    "time": 1300752000,
    "value": 8097000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 137,
    "time": 1300838400,
    "value": 5943000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 138,
    "time": 1300924800,
    "value": 6564000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 139,
    "time": 1301011200,
    "value": 8416500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 140,
    "time": 1301270400,
    "value": 15309000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 141,
    "time": 1301356800,
    "value": 11188500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 142,
    "time": 1301443200,
    "value": 18003000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 143,
    "time": 1301529600,
    "value": 163869000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 144,
    "time": 1301616000,
    "value": 42078000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 145,
    "time": 1301875200,
    "value": 38563500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 146,
    "time": 1301961600,
    "value": 46600500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 147,
    "time": 1302048000,
    "value": 18907500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 148,
    "time": 1302134400,
    "value": 41496000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 149,
    "time": 1302220800,
    "value": 28378500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 150,
    "time": 1302480000,
    "value": 20121000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 151,
    "time": 1302566400,
    "value": 20044500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 152,
    "time": 1302652800,
    "value": 17970000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 153,
    "time": 1302739200,
    "value": 14481000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 154,
    "time": 1302825600,
    "value": 13975500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 155,
    "time": 1303084800,
    "value": 15267000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 156,
    "time": 1303171200,
    "value": 8127000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 157,
    "time": 1303257600,
    "value": 12396000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 158,
    "time": 1303344000,
    "value": 19473000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 159,
    "time": 1303689600,
    "value": 11760000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 160,
    "time": 1303776000,
    "value": 20268000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 161,
    "time": 1303862400,
    "value": 14770500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 162,
    "time": 1303948800,
    "value": 23356500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 163,
    "time": 1304035200,
    "value": 9780000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 164,
    "time": 1304294400,
    "value": 11614500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 165,
    "time": 1304380800,
    "value": 13510500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 166,
    "time": 1304467200,
    "value": 15252000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 167,
    "time": 1304553600,
    "value": 17584500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 168,
    "time": 1304640000,
    "value": 13941000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 169,
    "time": 1304899200,
    "value": 13521000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 170,
    "time": 1304985600,
    "value": 22632000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 171,
    "time": 1305072000,
    "value": 14250000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 172,
    "time": 1305158400,
    "value": 9286500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 173,
    "time": 1305244800,
    "value": 9783000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 174,
    "time": 1305504000,
    "value": 11152500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 175,
    "time": 1305590400,
    "value": 18295500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 176,
    "time": 1305676800,
    "value": 10804500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 177,
    "time": 1305763200,
    "value": 38518500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 178,
    "time": 1305849600,
    "value": 12024000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 179,
    "time": 1306108800,
    "value": 12774000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 180,
    "time": 1306195200,
    "value": 9003000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 181,
    "time": 1306281600,
    "value": 69592500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 182,
    "time": 1306368000,
    "value": 48706500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 183,
    "time": 1306454400,
    "value": 24933000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 184,
    "time": 1306800000,
    "value": 48790500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 185,
    "time": 1306886400,
    "value": 22666500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 186,
    "time": 1306972800,
    "value": 14418000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 187,
    "time": 1307059200,
    "value": 92074500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 188,
    "time": 1307318400,
    "value": 34503000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 189,
    "time": 1307404800,
    "value": 17590500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 190,
    "time": 1307491200,
    "value": 25230000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 191,
    "time": 1307577600,
    "value": 23793000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 192,
    "time": 1307664000,
    "value": 22432500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 193,
    "time": 1307923200,
    "value": 25342500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 194,
    "time": 1308009600,
    "value": 23337000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 195,
    "time": 1308096000,
    "value": 19891500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 196,
    "time": 1308182400,
    "value": 26997000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 197,
    "time": 1308268800,
    "value": 25465500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 198,
    "time": 1308528000,
    "value": 22590000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 199,
    "time": 1308614400,
    "value": 22168500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 200,
    "time": 1308700800,
    "value": 21912000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 201,
    "time": 1308787200,
    "value": 17314500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 202,
    "time": 1308873600,
    "value": 49531500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 203,
    "time": 1309132800,
    "value": 16056000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 204,
    "time": 1309219200,
    "value": 13153500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 205,
    "time": 1309305600,
    "value": 21499500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 206,
    "time": 1309392000,
    "value": 13981500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 207,
    "time": 1309478400,
    "value": 12570000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 208,
    "time": 1309824000,
    "value": 14746500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 209,
    "time": 1309910400,
    "value": 13030500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 210,
    "time": 1309996800,
    "value": 19233000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 211,
    "time": 1310083200,
    "value": 18363000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 212,
    "time": 1310342400,
    "value": 14514000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 213,
    "time": 1310428800,
    "value": 15451500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 214,
    "time": 1310515200,
    "value": 15813000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 215,
    "time": 1310601600,
    "value": 17193000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 216,
    "time": 1310688000,
    "value": 10407000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 217,
    "time": 1310947200,
    "value": 12657000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 218,
    "time": 1311033600,
    "value": 14488500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 219,
    "time": 1311120000,
    "value": 45171000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 220,
    "time": 1311206400,
    "value": 14995500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 221,
    "time": 1311292800,
    "value": 8658000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 222,
    "time": 1311552000,
    "value": 9960000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 223,
    "time": 1311638400,
    "value": 11218500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 224,
    "time": 1311724800,
    "value": 13981500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 225,
    "time": 1311811200,
    "value": 13846500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 226,
    "time": 1311897600,
    "value": 13464000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 227,
    "time": 1312156800,
    "value": 16134000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 228,
    "time": 1312243200,
    "value": 21258000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 229,
    "time": 1312329600,
    "value": 25755000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 230,
    "time": 1312416000,
    "value": 44475000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 231,
    "time": 1312502400,
    "value": 28983000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 232,
    "time": 1312761600,
    "value": 38667000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 233,
    "time": 1312848000,
    "value": 19720500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 234,
    "time": 1312934400,
    "value": 22410000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 235,
    "time": 1313020800,
    "value": 12295500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 236,
    "time": 1313107200,
    "value": 14947500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 237,
    "time": 1313366400,
    "value": 10935000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 238,
    "time": 1313452800,
    "value": 7972500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 239,
    "time": 1313539200,
    "value": 9489000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 240,
    "time": 1313625600,
    "value": 15598500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 241,
    "time": 1313712000,
    "value": 18744000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 242,
    "time": 1313971200,
    "value": 14208000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 243,
    "time": 1314057600,
    "value": 12903000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 244,
    "time": 1314144000,
    "value": 10108500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 245,
    "time": 1314230400,
    "value": 10123500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 246,
    "time": 1314316800,
    "value": 11325000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 247,
    "time": 1314576000,
    "value": 11877000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 248,
    "time": 1314662400,
    "value": 5392500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 249,
    "time": 1314748800,
    "value": 12174000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 250,
    "time": 1314835200,
    "value": 12555000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 251,
    "time": 1314921600,
    "value": 11379000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 252,
    "time": 1315267200,
    "value": 11688000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 253,
    "time": 1315353600,
    "value": 6774000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 254,
    "time": 1315440000,
    "value": 6633000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 255,
    "time": 1315526400,
    "value": 9963000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 256,
    "time": 1315785600,
    "value": 8395500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 257,
    "time": 1315872000,
    "value": 10750500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 258,
    "time": 1315958400,
    "value": 12340500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 259,
    "time": 1316044800,
    "value": 8277000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 260,
    "time": 1316131200,
    "value": 20959500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 261,
    "time": 1316390400,
    "value": 17196000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 262,
    "time": 1316476800,
    "value": 16471500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 263,
    "time": 1316563200,
    "value": 14565000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 264,
    "time": 1316649600,
    "value": 11467500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 265,
    "time": 1316736000,
    "value": 16702500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 266,
    "time": 1316995200,
    "value": 13869000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 267,
    "time": 1317081600,
    "value": 9808500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 268,
    "time": 1317168000,
    "value": 10636500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 269,
    "time": 1317254400,
    "value": 12891000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 270,
    "time": 1317340800,
    "value": 19627500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 271,
    "time": 1317600000,
    "value": 15189000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 272,
    "time": 1317686400,
    "value": 17628000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 273,
    "time": 1317772800,
    "value": 17782500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 274,
    "time": 1317859200,
    "value": 24651000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 275,
    "time": 1317945600,
    "value": 19497000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 276,
    "time": 1318204800,
    "value": 12903000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 277,
    "time": 1318291200,
    "value": 8533500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 278,
    "time": 1318377600,
    "value": 16698000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 279,
    "time": 1318464000,
    "value": 15391500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 280,
    "time": 1318550400,
    "value": 20578500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 281,
    "time": 1318809600,
    "value": 11227500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 282,
    "time": 1318896000,
    "value": 14308500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 283,
    "time": 1318982400,
    "value": 11691000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 284,
    "time": 1319068800,
    "value": 14899500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 285,
    "time": 1319155200,
    "value": 14001000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 286,
    "time": 1319414400,
    "value": 13860000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 287,
    "time": 1319500800,
    "value": 9043500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 288,
    "time": 1319587200,
    "value": 7510500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 289,
    "time": 1319673600,
    "value": 12655500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 290,
    "time": 1319760000,
    "value": 18213000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 291,
    "time": 1320019200,
    "value": 16635000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 292,
    "time": 1320105600,
    "value": 9394500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 293,
    "time": 1320192000,
    "value": 12871500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 294,
    "time": 1320278400,
    "value": 36706500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 295,
    "time": 1320364800,
    "value": 43872000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 296,
    "time": 1320624000,
    "value": 18619500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 297,
    "time": 1320710400,
    "value": 15342000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 298,
    "time": 1320796800,
    "value": 14122500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 299,
    "time": 1320883200,
    "value": 11065500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 300,
    "time": 1320969600,
    "value": 56487000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 301,
    "time": 1321228800,
    "value": 18837000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 302,
    "time": 1321315200,
    "value": 13186500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 303,
    "time": 1321401600,
    "value": 26086500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 304,
    "time": 1321488000,
    "value": 20025000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 305,
    "time": 1321574400,
    "value": 13359000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 306,
    "time": 1321833600,
    "value": 15288000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 307,
    "time": 1321920000,
    "value": 10806000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 308,
    "time": 1322006400,
    "value": 6690000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 309,
    "time": 1322179200,
    "value": 3430500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 310,
    "time": 1322438400,
    "value": 10074000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 311,
    "time": 1322524800,
    "value": 8560500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 312,
    "time": 1322611200,
    "value": 11122500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 313,
    "time": 1322697600,
    "value": 14413500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 314,
    "time": 1322784000,
    "value": 10338000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 315,
    "time": 1323043200,
    "value": 15996000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 316,
    "time": 1323129600,
    "value": 14083500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 317,
    "time": 1323216000,
    "value": 9607500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 318,
    "time": 1323302400,
    "value": 48607500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 319,
    "time": 1323388800,
    "value": 18294000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 320,
    "time": 1323648000,
    "value": 11262000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 321,
    "time": 1323734400,
    "value": 14616000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 322,
    "time": 1323820800,
    "value": 17221500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 323,
    "time": 1323907200,
    "value": 10383000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 324,
    "time": 1323993600,
    "value": 14853000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 325,
    "time": 1324252800,
    "value": 14272500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 326,
    "time": 1324339200,
    "value": 12039000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 327,
    "time": 1324425600,
    "value": 25294500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 328,
    "time": 1324512000,
    "value": 14973000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 329,
    "time": 1324598400,
    "value": 8787000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 330,
    "time": 1324944000,
    "value": 10927500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 331,
    "time": 1325030400,
    "value": 8535000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 332,
    "time": 1325116800,
    "value": 7056000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 333,
    "time": 1325203200,
    "value": 4962000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 334,
    "time": 1325548800,
    "value": 13644000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 335,
    "time": 1325635200,
    "value": 9174000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 336,
    "time": 1325721600,
    "value": 14919000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 337,
    "time": 1325808000,
    "value": 14559000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 338,
    "time": 1326067200,
    "value": 13207500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 339,
    "time": 1326153600,
    "value": 9924000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 340,
    "time": 1326240000,
    "value": 9738000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 341,
    "time": 1326326400,
    "value": 9886500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 342,
    "time": 1326412800,
    "value": 80587500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 343,
    "time": 1326758400,
    "value": 68454000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 344,
    "time": 1326844800,
    "value": 17664000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 345,
    "time": 1326931200,
    "value": 18375000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 346,
    "time": 1327017600,
    "value": 9475500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 347,
    "time": 1327276800,
    "value": 8737500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 348,
    "time": 1327363200,
    "value": 12381000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 349,
    "time": 1327449600,
    "value": 8737500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 350,
    "time": 1327536000,
    "value": 17626500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 351,
    "time": 1327622400,
    "value": 10332000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 352,
    "time": 1327881600,
    "value": 10779000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 353,
    "time": 1327968000,
    "value": 13840500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 354,
    "time": 1328054400,
    "value": 7369500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 355,
    "time": 1328140800,
    "value": 11790000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 356,
    "time": 1328227200,
    "value": 11242500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 357,
    "time": 1328486400,
    "value": 9498000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 358,
    "time": 1328572800,
    "value": 14199000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 359,
    "time": 1328659200,
    "value": 9072000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 360,
    "time": 1328745600,
    "value": 17317500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 361,
    "time": 1328832000,
    "value": 27693000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 362,
    "time": 1329091200,
    "value": 16954500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 363,
    "time": 1329177600,
    "value": 26682000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 364,
    "time": 1329264000,
    "value": 40675500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 365,
    "time": 1329350400,
    "value": 32883000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 366,
    "time": 1329436800,
    "value": 20112000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 367,
    "time": 1329782400,
    "value": 16618500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 368,
    "time": 1329868800,
    "value": 23985000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 369,
    "time": 1329955200,
    "value": 11665500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 370,
    "time": 1330041600,
    "value": 14241000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 371,
    "time": 1330300800,
    "value": 8934000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 372,
    "time": 1330387200,
    "value": 9070500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 373,
    "time": 1330473600,
    "value": 7635000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 374,
    "time": 1330560000,
    "value": 8875500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 375,
    "time": 1330646400,
    "value": 7927500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 376,
    "time": 1330905600,
    "value": 6894000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 377,
    "time": 1330992000,
    "value": 7669500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 378,
    "time": 1331078400,
    "value": 5398500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 379,
    "time": 1331164800,
    "value": 8953500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 380,
    "time": 1331251200,
    "value": 22969500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 381,
    "time": 1331510400,
    "value": 28791000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 382,
    "time": 1331596800,
    "value": 14412000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 383,
    "time": 1331683200,
    "value": 12595500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 384,
    "time": 1331769600,
    "value": 8461500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 385,
    "time": 1331856000,
    "value": 10819500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 386,
    "time": 1332115200,
    "value": 14856000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 387,
    "time": 1332201600,
    "value": 8392500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 388,
    "time": 1332288000,
    "value": 8650500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 389,
    "time": 1332374400,
    "value": 7563000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 390,
    "time": 1332460800,
    "value": 16336500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 391,
    "time": 1332720000,
    "value": 46437000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 392,
    "time": 1332806400,
    "value": 36403500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 393,
    "time": 1332892800,
    "value": 13975500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 394,
    "time": 1332979200,
    "value": 10455000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 395,
    "time": 1333065600,
    "value": 11152500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 396,
    "time": 1333324800,
    "value": 13074000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 397,
    "time": 1333411200,
    "value": 16107000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 398,
    "time": 1333497600,
    "value": 66337500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 399,
    "time": 1333584000,
    "value": 21292500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 400,
    "time": 1333929600,
    "value": 24487500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 401,
    "time": 1334016000,
    "value": 25423500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 402,
    "time": 1334102400,
    "value": 16089000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 403,
    "time": 1334188800,
    "value": 14713500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 404,
    "time": 1334275200,
    "value": 9622500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 405,
    "time": 1334534400,
    "value": 15481500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 406,
    "time": 1334620800,
    "value": 16413000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 407,
    "time": 1334707200,
    "value": 12088500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 408,
    "time": 1334793600,
    "value": 11424000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 409,
    "time": 1334880000,
    "value": 12180000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 410,
    "time": 1335139200,
    "value": 13161000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 411,
    "time": 1335225600,
    "value": 9708000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 412,
    "time": 1335312000,
    "value": 10542000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 413,
    "time": 1335398400,
    "value": 6229500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 414,
    "time": 1335484800,
    "value": 8539500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 415,
    "time": 1335744000,
    "value": 6088500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 416,
    "time": 1335830400,
    "value": 9690000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 417,
    "time": 1335916800,
    "value": 7291500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 418,
    "time": 1336003200,
    "value": 12472500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 419,
    "time": 1336089600,
    "value": 18291000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 420,
    "time": 1336348800,
    "value": 16948500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 421,
    "time": 1336435200,
    "value": 45520500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 422,
    "time": 1336521600,
    "value": 28653000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 423,
    "time": 1336608000,
    "value": 82389000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 424,
    "time": 1336694400,
    "value": 18039000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 425,
    "time": 1336953600,
    "value": 20400000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 426,
    "time": 1337040000,
    "value": 22992000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 427,
    "time": 1337126400,
    "value": 18601500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 428,
    "time": 1337212800,
    "value": 16810500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 429,
    "time": 1337299200,
    "value": 22939500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 430,
    "time": 1337558400,
    "value": 21505500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 431,
    "time": 1337644800,
    "value": 35101500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 432,
    "time": 1337731200,
    "value": 18036000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 433,
    "time": 1337817600,
    "value": 15760500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 434,
    "time": 1337904000,
    "value": 11173500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 435,
    "time": 1338249600,
    "value": 23724000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 436,
    "time": 1338336000,
    "value": 19323000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 437,
    "time": 1338422400,
    "value": 15906000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 438,
    "time": 1338508800,
    "value": 13029000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 439,
    "time": 1338768000,
    "value": 15243000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 440,
    "time": 1338854400,
    "value": 9331500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 441,
    "time": 1338940800,
    "value": 13300500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 442,
    "time": 1339027200,
    "value": 7242000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 443,
    "time": 1339113600,
    "value": 12514500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 444,
    "time": 1339372800,
    "value": 9043500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 445,
    "time": 1339459200,
    "value": 8221500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 446,
    "time": 1339545600,
    "value": 12510000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 447,
    "time": 1339632000,
    "value": 12885000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 448,
    "time": 1339718400,
    "value": 8910000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 449,
    "time": 1339977600,
    "value": 17913000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 450,
    "time": 1340064000,
    "value": 13380000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 451,
    "time": 1340150400,
    "value": 50334000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 452,
    "time": 1340236800,
    "value": 25275000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 453,
    "time": 1340323200,
    "value": 44323500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 454,
    "time": 1340582400,
    "value": 22111500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 455,
    "time": 1340668800,
    "value": 37164000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 456,
    "time": 1340755200,
    "value": 14725500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 457,
    "time": 1340841600,
    "value": 13173000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 458,
    "time": 1340928000,
    "value": 15910500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 459,
    "time": 1341187200,
    "value": 19246500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 460,
    "time": 1341273600,
    "value": 13993500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 461,
    "time": 1341446400,
    "value": 18108000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 462,
    "time": 1341532800,
    "value": 10950000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 463,
    "time": 1341792000,
    "value": 13303500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 464,
    "time": 1341878400,
    "value": 10500000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 465,
    "time": 1341964800,
    "value": 8515500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 466,
    "time": 1342051200,
    "value": 15897000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 467,
    "time": 1342137600,
    "value": 19225500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 468,
    "time": 1342396800,
    "value": 25431000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 469,
    "time": 1342483200,
    "value": 37756500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 470,
    "time": 1342569600,
    "value": 42406500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 471,
    "time": 1342656000,
    "value": 21282000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 472,
    "time": 1342742400,
    "value": 23131500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 473,
    "time": 1343001600,
    "value": 20463000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 474,
    "time": 1343088000,
    "value": 21778500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 475,
    "time": 1343174400,
    "value": 37428000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 476,
    "time": 1343260800,
    "value": 33084000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 477,
    "time": 1343347200,
    "value": 24735000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 478,
    "time": 1343606400,
    "value": 29761500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 479,
    "time": 1343692800,
    "value": 20505000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 480,
    "time": 1343779200,
    "value": 21585000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 481,
    "time": 1343865600,
    "value": 19086000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 482,
    "time": 1343952000,
    "value": 17092500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 483,
    "time": 1344211200,
    "value": 17017500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 484,
    "time": 1344297600,
    "value": 28341000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 485,
    "time": 1344384000,
    "value": 17298000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 486,
    "time": 1344470400,
    "value": 9636000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 487,
    "time": 1344556800,
    "value": 10066500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 488,
    "time": 1344816000,
    "value": 12691500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 489,
    "time": 1344902400,
    "value": 11076000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 490,
    "time": 1344988800,
    "value": 7506000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 491,
    "time": 1345075200,
    "value": 8028000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 492,
    "time": 1345161600,
    "value": 7033500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 493,
    "time": 1345420800,
    "value": 13743000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 494,
    "time": 1345507200,
    "value": 10840500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 495,
    "time": 1345593600,
    "value": 10396500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 496,
    "time": 1345680000,
    "value": 21502500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 497,
    "time": 1345766400,
    "value": 20377500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 498,
    "time": 1346025600,
    "value": 18559500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 499,
    "time": 1346112000,
    "value": 20662500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 500,
    "time": 1346198400,
    "value": 12213000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 501,
    "time": 1346284800,
    "value": 9609000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 502,
    "time": 1346371200,
    "value": 7690500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 503,
    "time": 1346716800,
    "value": 10840500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 504,
    "time": 1346803200,
    "value": 9276000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 505,
    "time": 1346889600,
    "value": 12036000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 506,
    "time": 1346976000,
    "value": 13315500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 507,
    "time": 1347235200,
    "value": 20403000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 508,
    "time": 1347321600,
    "value": 12136500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 509,
    "time": 1347408000,
    "value": 16017000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 510,
    "time": 1347494400,
    "value": 20878500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 511,
    "time": 1347580800,
    "value": 21982500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 512,
    "time": 1347840000,
    "value": 46476000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 513,
    "time": 1347926400,
    "value": 26220000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 514,
    "time": 1348012800,
    "value": 15385500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 515,
    "time": 1348099200,
    "value": 10585500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 516,
    "time": 1348185600,
    "value": 24996000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 517,
    "time": 1348444800,
    "value": 18555000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 518,
    "time": 1348531200,
    "value": 78354000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 519,
    "time": 1348617600,
    "value": 22567500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 520,
    "time": 1348704000,
    "value": 26001000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 521,
    "time": 1348790400,
    "value": 64419000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 522,
    "time": 1349049600,
    "value": 12910500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 523,
    "time": 1349136000,
    "value": 10389000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 524,
    "time": 1349222400,
    "value": 12870000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 525,
    "time": 1349308800,
    "value": 18454500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 526,
    "time": 1349395200,
    "value": 12109500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 527,
    "time": 1349654400,
    "value": 13128000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 528,
    "time": 1349740800,
    "value": 17464500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 529,
    "time": 1349827200,
    "value": 7413000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 530,
    "time": 1349913600,
    "value": 6646500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 531,
    "time": 1350000000,
    "value": 13588500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 532,
    "time": 1350259200,
    "value": 20388000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 533,
    "time": 1350345600,
    "value": 7063500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 534,
    "time": 1350432000,
    "value": 9720000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 535,
    "time": 1350518400,
    "value": 9792000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 536,
    "time": 1350604800,
    "value": 10015500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 537,
    "time": 1350864000,
    "value": 5101500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 538,
    "time": 1350950400,
    "value": 8620500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 539,
    "time": 1351036800,
    "value": 12669000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 540,
    "time": 1351123200,
    "value": 8308500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 541,
    "time": 1351209600,
    "value": 6726000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 542,
    "time": 1351641600,
    "value": 11193000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 543,
    "time": 1351728000,
    "value": 14761500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 544,
    "time": 1351814400,
    "value": 14913000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 545,
    "time": 1352073600,
    "value": 29164500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 546,
    "time": 1352160000,
    "value": 34033500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 547,
    "time": 1352246400,
    "value": 25089000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 548,
    "time": 1352332800,
    "value": 18096000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 549,
    "time": 1352419200,
    "value": 12726000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 550,
    "time": 1352678400,
    "value": 8142000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 551,
    "time": 1352764800,
    "value": 14413500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 552,
    "time": 1352851200,
    "value": 12508500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 553,
    "time": 1352937600,
    "value": 13594500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 554,
    "time": 1353024000,
    "value": 12493500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 555,
    "time": 1353283200,
    "value": 19404000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 556,
    "time": 1353369600,
    "value": 13012500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 557,
    "time": 1353456000,
    "value": 12994500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 558,
    "time": 1353628800,
    "value": 6234000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 559,
    "time": 1353888000,
    "value": 6823500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 560,
    "time": 1353974400,
    "value": 10090500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 561,
    "time": 1354060800,
    "value": 22344000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 562,
    "time": 1354147200,
    "value": 15483000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 563,
    "time": 1354233600,
    "value": 20268000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 564,
    "time": 1354492800,
    "value": 26139000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 565,
    "time": 1354579200,
    "value": 18213000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 566,
    "time": 1354665600,
    "value": 7434000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 567,
    "time": 1354752000,
    "value": 9687000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 568,
    "time": 1354838400,
    "value": 9814500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 569,
    "time": 1355097600,
    "value": 13413000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 570,
    "time": 1355184000,
    "value": 22396500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 571,
    "time": 1355270400,
    "value": 29326500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 572,
    "time": 1355356800,
    "value": 31737000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 573,
    "time": 1355443200,
    "value": 14131500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 574,
    "time": 1355702400,
    "value": 12079500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 575,
    "time": 1355788800,
    "value": 23095500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 576,
    "time": 1355875200,
    "value": 18744000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 577,
    "time": 1355961600,
    "value": 13641000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 578,
    "time": 1356048000,
    "value": 21853500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 579,
    "time": 1356307200,
    "value": 5562000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 580,
    "time": 1356480000,
    "value": 8796000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 581,
    "time": 1356566400,
    "value": 8053500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 582,
    "time": 1356652800,
    "value": 6033000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 583,
    "time": 1356912000,
    "value": 8590500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 584,
    "time": 1357084800,
    "value": 16518000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 585,
    "time": 1357171200,
    "value": 10825500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 586,
    "time": 1363219200,
    "value": 29146500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 587,
    "time": 1363305600,
    "value": 42304500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 588,
    "time": 1363564800,
    "value": 17931000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 589,
    "time": 1363651200,
    "value": 15828000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 590,
    "time": 1363737600,
    "value": 16198500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 591,
    "time": 1363824000,
    "value": 15042000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 592,
    "time": 1363910400,
    "value": 6421500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 593,
    "time": 1364169600,
    "value": 34368000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 594,
    "time": 1364256000,
    "value": 22050000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 595,
    "time": 1364342400,
    "value": 18799500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 596,
    "time": 1364428800,
    "value": 11656500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 597,
    "time": 1364774400,
    "value": 201547500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 598,
    "time": 1364860800,
    "value": 94021500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 599,
    "time": 1364947200,
    "value": 82765500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 600,
    "time": 1365033600,
    "value": 32724000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 601,
    "time": 1365120000,
    "value": 20602500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 602,
    "time": 1365379200,
    "value": 23578500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 603,
    "time": 1365465600,
    "value": 22929000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 604,
    "time": 1365552000,
    "value": 29934000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 605,
    "time": 1365638400,
    "value": 50419500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 606,
    "time": 1365724800,
    "value": 43282500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 607,
    "time": 1365984000,
    "value": 23191500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 608,
    "time": 1366070400,
    "value": 41016000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 609,
    "time": 1366156800,
    "value": 29680500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 610,
    "time": 1366243200,
    "value": 45765000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 611,
    "time": 1366329600,
    "value": 43929000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 612,
    "time": 1366588800,
    "value": 56449500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 613,
    "time": 1366675200,
    "value": 53149500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 614,
    "time": 1366761600,
    "value": 36709500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 615,
    "time": 1366848000,
    "value": 40113000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 616,
    "time": 1366934400,
    "value": 52822500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 617,
    "time": 1367193600,
    "value": 52944000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 618,
    "time": 1367280000,
    "value": 79696500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 619,
    "time": 1367366400,
    "value": 37645500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 620,
    "time": 1367452800,
    "value": 44152500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 621,
    "time": 1367539200,
    "value": 49215000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 622,
    "time": 1367798400,
    "value": 63787500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 623,
    "time": 1367884800,
    "value": 145771500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 624,
    "time": 1367971200,
    "value": 97968000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 625,
    "time": 1368057600,
    "value": 416440500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 626,
    "time": 1368144000,
    "value": 362424000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 627,
    "time": 1368403200,
    "value": 324441000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 628,
    "time": 1368489600,
    "value": 540166500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 629,
    "time": 1368576000,
    "value": 245694000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 630,
    "time": 1368662400,
    "value": 314040000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 631,
    "time": 1368748800,
    "value": 275742000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 632,
    "time": 1369008000,
    "value": 116409000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 633,
    "time": 1369094400,
    "value": 129556500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 634,
    "time": 1369180800,
    "value": 124705500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 635,
    "time": 1369267200,
    "value": 173866500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 636,
    "time": 1369353600,
    "value": 234340500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 637,
    "time": 1369699200,
    "value": 286362000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 638,
    "time": 1369785600,
    "value": 365599500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 639,
    "time": 1369872000,
    "value": 232486500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 640,
    "time": 1369958400,
    "value": 216676500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 641,
    "time": 1370217600,
    "value": 279295500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 642,
    "time": 1370304000,
    "value": 128937000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 643,
    "time": 1370390400,
    "value": 178788000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 644,
    "time": 1370476800,
    "value": 139008000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 645,
    "time": 1370563200,
    "value": 154503000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 646,
    "time": 1370822400,
    "value": 134262000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 647,
    "time": 1370908800,
    "value": 107361000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 648,
    "time": 1370995200,
    "value": 133843500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 649,
    "time": 1371081600,
    "value": 87330000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 650,
    "time": 1371168000,
    "value": 95694000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 651,
    "time": 1371427200,
    "value": 103032000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 652,
    "time": 1371513600,
    "value": 129123000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 653,
    "time": 1371600000,
    "value": 125938500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 654,
    "time": 1371686400,
    "value": 148359000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 655,
    "time": 1371772800,
    "value": 171208500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 656,
    "time": 1372032000,
    "value": 104620500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 657,
    "time": 1372118400,
    "value": 85672500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 658,
    "time": 1372204800,
    "value": 95920500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 659,
    "time": 1372291200,
    "value": 127455000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 660,
    "time": 1372377600,
    "value": 84156000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 661,
    "time": 1372636800,
    "value": 159403500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 662,
    "time": 1372723200,
    "value": 177274500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 663,
    "time": 1372809600,
    "value": 70027500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 664,
    "time": 1372982400,
    "value": 99724500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 665,
    "time": 1373241600,
    "value": 113974500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 666,
    "time": 1373328000,
    "value": 121951500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 667,
    "time": 1373414400,
    "value": 81409500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 668,
    "time": 1373500800,
    "value": 107755500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 669,
    "time": 1373587200,
    "value": 166258500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 670,
    "time": 1373846400,
    "value": 144150000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 671,
    "time": 1373932800,
    "value": 469743000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 672,
    "time": 1374019200,
    "value": 379722000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 673,
    "time": 1374105600,
    "value": 166929000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 674,
    "time": 1374192000,
    "value": 85578000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 675,
    "time": 1374451200,
    "value": 143059500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 676,
    "time": 1374537600,
    "value": 111156000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 677,
    "time": 1374624000,
    "value": 99454500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 678,
    "time": 1374710400,
    "value": 76276500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 679,
    "time": 1374796800,
    "value": 139750500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 680,
    "time": 1375056000,
    "value": 141123000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 681,
    "time": 1375142400,
    "value": 190620000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 682,
    "time": 1375228800,
    "value": 92283000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 683,
    "time": 1375315200,
    "value": 77371500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 684,
    "time": 1375401600,
    "value": 90321000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 685,
    "time": 1375660800,
    "value": 148099500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 686,
    "time": 1375747200,
    "value": 133714500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 687,
    "time": 1375833600,
    "value": 264238500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 688,
    "time": 1375920000,
    "value": 387346500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 689,
    "time": 1376006400,
    "value": 129208500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 690,
    "time": 1376265600,
    "value": 215790000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 691,
    "time": 1376352000,
    "value": 124554000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 692,
    "time": 1376438400,
    "value": 166930500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 693,
    "time": 1376524800,
    "value": 147001500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 694,
    "time": 1376611200,
    "value": 101158500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 695,
    "time": 1376870400,
    "value": 116574000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 696,
    "time": 1376956800,
    "value": 90135000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 697,
    "time": 1377043200,
    "value": 89446500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 698,
    "time": 1377129600,
    "value": 151780500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 699,
    "time": 1377216000,
    "value": 187560000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 700,
    "time": 1377475200,
    "value": 350391000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 701,
    "time": 1377561600,
    "value": 248074500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 702,
    "time": 1377648000,
    "value": 209382000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 703,
    "time": 1377734400,
    "value": 134815500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 704,
    "time": 1377820800,
    "value": 161145000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 705,
    "time": 1378166400,
    "value": 174235500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 706,
    "time": 1378252800,
    "value": 164263500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 707,
    "time": 1378339200,
    "value": 95404500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 708,
    "time": 1378425600,
    "value": 122739000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 709,
    "time": 1378684800,
    "value": 207159000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 710,
    "time": 1378771200,
    "value": 128748000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 711,
    "time": 1378857600,
    "value": 83227500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 712,
    "time": 1378944000,
    "value": 90027000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 713,
    "time": 1379030400,
    "value": 75963000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 714,
    "time": 1379289600,
    "value": 109735500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 715,
    "time": 1379376000,
    "value": 78295500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 716,
    "time": 1379462400,
    "value": 78660000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 717,
    "time": 1379548800,
    "value": 224395500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 718,
    "time": 1379635200,
    "value": 194923500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 719,
    "time": 1379894400,
    "value": 119229000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 720,
    "time": 1379980800,
    "value": 90906000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 721,
    "time": 1380067200,
    "value": 117744000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 722,
    "time": 1380153600,
    "value": 95916000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 723,
    "time": 1380240000,
    "value": 84856500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 724,
    "time": 1380499200,
    "value": 129867000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 725,
    "time": 1380585600,
    "value": 112054500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 726,
    "time": 1380672000,
    "value": 298063500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 727,
    "time": 1380758400,
    "value": 342652500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 728,
    "time": 1380844800,
    "value": 209007000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 729,
    "time": 1381104000,
    "value": 166999500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 730,
    "time": 1381190400,
    "value": 198939000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 731,
    "time": 1381276800,
    "value": 220770000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 732,
    "time": 1381363200,
    "value": 129027000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 733,
    "time": 1381449600,
    "value": 119569500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 734,
    "time": 1381708800,
    "value": 112860000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 735,
    "time": 1381795200,
    "value": 159427500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 736,
    "time": 1381881600,
    "value": 119692500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 737,
    "time": 1381968000,
    "value": 97383000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 738,
    "time": 1382054400,
    "value": 85054500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 739,
    "time": 1382313600,
    "value": 165351000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 740,
    "time": 1382400000,
    "value": 166023000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 741,
    "time": 1382486400,
    "value": 190072500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 742,
    "time": 1382572800,
    "value": 158160000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 743,
    "time": 1382659200,
    "value": 110428500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 744,
    "time": 1382918400,
    "value": 112183500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 745,
    "time": 1383004800,
    "value": 205161000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 746,
    "time": 1383091200,
    "value": 121746000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 747,
    "time": 1383177600,
    "value": 131301000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 748,
    "time": 1383264000,
    "value": 104220000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 749,
    "time": 1383523200,
    "value": 188814000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 750,
    "time": 1383609600,
    "value": 319066500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 751,
    "time": 1383696000,
    "value": 442978500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 752,
    "time": 1383782400,
    "value": 319876500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 753,
    "time": 1383868800,
    "value": 316498500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 754,
    "time": 1384128000,
    "value": 202396500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 755,
    "time": 1384214400,
    "value": 213652500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 756,
    "time": 1384300800,
    "value": 175584000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 757,
    "time": 1384387200,
    "value": 175161000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 758,
    "time": 1384473600,
    "value": 143160000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 759,
    "time": 1384732800,
    "value": 333507000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 760,
    "time": 1384819200,
    "value": 282606000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 761,
    "time": 1384905600,
    "value": 199353000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 762,
    "time": 1384992000,
    "value": 172042500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 763,
    "time": 1385078400,
    "value": 162112500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 764,
    "time": 1385337600,
    "value": 150082500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 765,
    "time": 1385424000,
    "value": 201268500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 766,
    "time": 1385510400,
    "value": 178762500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 767,
    "time": 1385683200,
    "value": 142236000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 768,
    "time": 1385942400,
    "value": 110358000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 769,
    "time": 1386028800,
    "value": 374767500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 770,
    "time": 1386115200,
    "value": 191470500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 771,
    "time": 1386201600,
    "value": 134154000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 772,
    "time": 1386288000,
    "value": 115554000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 773,
    "time": 1386547200,
    "value": 150270000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 774,
    "time": 1386633600,
    "value": 172441500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 775,
    "time": 1386720000,
    "value": 111934500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 776,
    "time": 1386806400,
    "value": 173362500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 777,
    "time": 1386892800,
    "value": 174357000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 778,
    "time": 1387152000,
    "value": 109501500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 779,
    "time": 1387238400,
    "value": 174391500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 780,
    "time": 1387324800,
    "value": 182674500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 781,
    "time": 1387411200,
    "value": 202656000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 782,
    "time": 1387497600,
    "value": 123055500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 783,
    "time": 1387756800,
    "value": 88005000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 784,
    "time": 1387843200,
    "value": 159850500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 785,
    "time": 1388016000,
    "value": 118942500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 786,
    "time": 1388102400,
    "value": 93999000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 787,
    "time": 1388361600,
    "value": 74286000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 788,
    "time": 1388448000,
    "value": 72408000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 789,
    "time": 1388620800,
    "value": 102918000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 790,
    "time": 1388707200,
    "value": 78061500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 791,
    "time": 1388966400,
    "value": 89131500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 792,
    "time": 1389052800,
    "value": 83844000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 793,
    "time": 1389139200,
    "value": 101304000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 794,
    "time": 1389225600,
    "value": 88711500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 795,
    "time": 1389312000,
    "value": 126364500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 796,
    "time": 1389571200,
    "value": 84717000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 797,
    "time": 1389657600,
    "value": 379350000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 798,
    "time": 1389744000,
    "value": 274327500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 799,
    "time": 1389830400,
    "value": 160425000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 800,
    "time": 1389916800,
    "value": 124987500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 801,
    "time": 1390262400,
    "value": 130549500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 802,
    "time": 1390348800,
    "value": 90628500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 803,
    "time": 1390435200,
    "value": 104628000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 804,
    "time": 1390521600,
    "value": 101746500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 805,
    "time": 1390780800,
    "value": 115896000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 806,
    "time": 1390867200,
    "value": 80989500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 807,
    "time": 1390953600,
    "value": 77025000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 808,
    "time": 1391040000,
    "value": 107673000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 809,
    "time": 1391126400,
    "value": 84319500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 810,
    "time": 1391385600,
    "value": 89644500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 811,
    "time": 1391472000,
    "value": 62623500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 812,
    "time": 1391558400,
    "value": 93388500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 813,
    "time": 1391644800,
    "value": 73384500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 814,
    "time": 1391731200,
    "value": 117148500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 815,
    "time": 1391990400,
    "value": 164770500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 816,
    "time": 1392076800,
    "value": 140068500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 817,
    "time": 1392163200,
    "value": 66439500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 818,
    "time": 1392249600,
    "value": 105280500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 819,
    "time": 1392336000,
    "value": 80040000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 820,
    "time": 1392681600,
    "value": 117477000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 821,
    "time": 1392768000,
    "value": 202486500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 822,
    "time": 1392854400,
    "value": 231760500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 823,
    "time": 1392940800,
    "value": 102037500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 824,
    "time": 1393200000,
    "value": 108903000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 825,
    "time": 1393286400,
    "value": 420369000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 826,
    "time": 1393372800,
    "value": 312486000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 827,
    "time": 1393459200,
    "value": 223077000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 828,
    "time": 1393545600,
    "value": 180037500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 829,
    "time": 1393804800,
    "value": 165219000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 830,
    "time": 1393891200,
    "value": 108879000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 831,
    "time": 1393977600,
    "value": 72594000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 832,
    "time": 1394064000,
    "value": 94290000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 833,
    "time": 1394150400,
    "value": 95437500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 834,
    "time": 1394409600,
    "value": 97983000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 835,
    "time": 1394496000,
    "value": 109213500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 836,
    "time": 1394582400,
    "value": 123525000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 837,
    "time": 1394668800,
    "value": 79090500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 838,
    "time": 1394755200,
    "value": 103077000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 839,
    "time": 1395014400,
    "value": 76896000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 840,
    "time": 1395100800,
    "value": 78610500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 841,
    "time": 1395187200,
    "value": 62955000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 842,
    "time": 1395273600,
    "value": 47638500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 843,
    "time": 1395360000,
    "value": 104617500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 844,
    "time": 1395619200,
    "value": 142279500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 845,
    "time": 1395705600,
    "value": 99859500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 846,
    "time": 1395792000,
    "value": 87933000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 847,
    "time": 1395878400,
    "value": 120972000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 848,
    "time": 1395964800,
    "value": 125509500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 849,
    "time": 1396224000,
    "value": 106504500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 850,
    "time": 1396310400,
    "value": 93630000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 851,
    "time": 1396396800,
    "value": 138853500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 852,
    "time": 1396483200,
    "value": 140214000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 853,
    "time": 1396569600,
    "value": 146892000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 854,
    "time": 1396828800,
    "value": 126373500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 855,
    "time": 1396915200,
    "value": 87385500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 856,
    "time": 1397001600,
    "value": 65019000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 857,
    "time": 1397088000,
    "value": 89880000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 858,
    "time": 1397174400,
    "value": 115252500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 859,
    "time": 1397433600,
    "value": 96993000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 860,
    "time": 1397520000,
    "value": 174859500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 861,
    "time": 1397606400,
    "value": 87391500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 862,
    "time": 1397692800,
    "value": 75393000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 863,
    "time": 1398038400,
    "value": 67105500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 864,
    "time": 1398124800,
    "value": 123586500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 865,
    "time": 1398211200,
    "value": 91764000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 866,
    "time": 1398297600,
    "value": 67018500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 867,
    "time": 1398384000,
    "value": 88900500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 868,
    "time": 1398643200,
    "value": 90400500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 869,
    "time": 1398729600,
    "value": 74610000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 870,
    "time": 1398816000,
    "value": 55795500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 871,
    "time": 1398902400,
    "value": 68469000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 872,
    "time": 1398988800,
    "value": 51756000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 873,
    "time": 1399248000,
    "value": 62872500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 874,
    "time": 1399334400,
    "value": 71347500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 875,
    "time": 1399420800,
    "value": 127287000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 876,
    "time": 1399507200,
    "value": 257352000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 877,
    "time": 1399593600,
    "value": 109512000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 878,
    "time": 1399852800,
    "value": 91471500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 879,
    "time": 1399939200,
    "value": 91531500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 880,
    "time": 1400025600,
    "value": 70441500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 881,
    "time": 1400112000,
    "value": 79266000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 882,
    "time": 1400198400,
    "value": 57685500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 883,
    "time": 1400457600,
    "value": 59709000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 884,
    "time": 1400544000,
    "value": 72919500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 885,
    "time": 1400630400,
    "value": 67347000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 886,
    "time": 1400716800,
    "value": 77029500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 887,
    "time": 1400803200,
    "value": 49992000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 888,
    "time": 1401148800,
    "value": 68053500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 889,
    "time": 1401235200,
    "value": 68530500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 890,
    "time": 1401321600,
    "value": 46740000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 891,
    "time": 1401408000,
    "value": 72352500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 892,
    "time": 1401667200,
    "value": 59125500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 893,
    "time": 1401753600,
    "value": 50698500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 894,
    "time": 1401840000,
    "value": 44190000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 895,
    "time": 1401926400,
    "value": 50929500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 896,
    "time": 1402012800,
    "value": 39301500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 897,
    "time": 1402272000,
    "value": 34545000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 898,
    "time": 1402358400,
    "value": 43896000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 899,
    "time": 1402444800,
    "value": 52020000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 900,
    "time": 1402531200,
    "value": 78660000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 901,
    "time": 1402617600,
    "value": 91671000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 902,
    "time": 1402876800,
    "value": 171028500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 903,
    "time": 1402963200,
    "value": 169213500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 904,
    "time": 1403049600,
    "value": 89343000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 905,
    "time": 1403136000,
    "value": 114487500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 906,
    "time": 1403222400,
    "value": 63924000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 907,
    "time": 1403481600,
    "value": 100888500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 908,
    "time": 1403568000,
    "value": 104314500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 909,
    "time": 1403654400,
    "value": 74611500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 910,
    "time": 1403740800,
    "value": 65886000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 911,
    "time": 1403827200,
    "value": 75367500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 912,
    "time": 1404086400,
    "value": 61995000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 913,
    "time": 1404172800,
    "value": 53196000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 914,
    "time": 1404259200,
    "value": 102298500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 915,
    "time": 1404345600,
    "value": 66034500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 916,
    "time": 1404691200,
    "value": 74419500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 917,
    "time": 1404777600,
    "value": 101098500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 918,
    "time": 1404864000,
    "value": 50980500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 919,
    "time": 1404950400,
    "value": 63258000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 920,
    "time": 1405036800,
    "value": 41347500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 921,
    "time": 1405296000,
    "value": 92257500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 922,
    "time": 1405382400,
    "value": 71305500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 923,
    "time": 1405468800,
    "value": 51513000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 924,
    "time": 1405555200,
    "value": 57648000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 925,
    "time": 1405641600,
    "value": 53826000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 926,
    "time": 1405900800,
    "value": 49165500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 927,
    "time": 1405987200,
    "value": 35058000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 928,
    "time": 1406073600,
    "value": 39615000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 929,
    "time": 1406160000,
    "value": 39552000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 930,
    "time": 1406246400,
    "value": 39411000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 931,
    "time": 1406505600,
    "value": 84943500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 932,
    "time": 1406592000,
    "value": 41269500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 933,
    "time": 1406678400,
    "value": 60807000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 934,
    "time": 1406764800,
    "value": 96696000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 935,
    "time": 1406851200,
    "value": 153400500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 936,
    "time": 1407110400,
    "value": 75952500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 937,
    "time": 1407196800,
    "value": 67884000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 938,
    "time": 1407283200,
    "value": 118677000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 939,
    "time": 1407369600,
    "value": 95010000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 940,
    "time": 1407456000,
    "value": 64384500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 941,
    "time": 1407715200,
    "value": 101056500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 942,
    "time": 1407801600,
    "value": 74634000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 943,
    "time": 1407888000,
    "value": 88335000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 944,
    "time": 1407974400,
    "value": 51877500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 945,
    "time": 1408060800,
    "value": 47685000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 946,
    "time": 1408320000,
    "value": 71943000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 947,
    "time": 1408406400,
    "value": 66840000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 948,
    "time": 1408492800,
    "value": 38166000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 949,
    "time": 1408579200,
    "value": 37018500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 950,
    "time": 1408665600,
    "value": 35620500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 951,
    "time": 1408924800,
    "value": 55287000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 952,
    "time": 1409011200,
    "value": 47110500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 953,
    "time": 1409097600,
    "value": 38287500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 954,
    "time": 1409184000,
    "value": 36576000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 955,
    "time": 1409270400,
    "value": 82822500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 956,
    "time": 1409616000,
    "value": 122932500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 957,
    "time": 1409702400,
    "value": 83658000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 958,
    "time": 1409788800,
    "value": 104331000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 959,
    "time": 1409875200,
    "value": 136144500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 960,
    "time": 1410134400,
    "value": 69922500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 961,
    "time": 1410220800,
    "value": 57493500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 962,
    "time": 1410307200,
    "value": 46741500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 963,
    "time": 1410393600,
    "value": 48127500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 964,
    "time": 1410480000,
    "value": 41457000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 965,
    "time": 1410739200,
    "value": 209746500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 966,
    "time": 1410825600,
    "value": 106606500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 967,
    "time": 1410912000,
    "value": 65944500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 968,
    "time": 1410998400,
    "value": 47353500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 969,
    "time": 1411084800,
    "value": 87552000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 970,
    "time": 1411344000,
    "value": 104559000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 971,
    "time": 1411430400,
    "value": 73747500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 972,
    "time": 1411516800,
    "value": 48142500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 973,
    "time": 1411603200,
    "value": 61905000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 974,
    "time": 1411689600,
    "value": 49257000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 975,
    "time": 1411948800,
    "value": 61668000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 976,
    "time": 1412035200,
    "value": 54453000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 977,
    "time": 1412121600,
    "value": 75615000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 978,
    "time": 1412208000,
    "value": 118692000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 979,
    "time": 1412294400,
    "value": 70530000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 980,
    "time": 1412553600,
    "value": 102403500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 981,
    "time": 1412640000,
    "value": 59218500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 982,
    "time": 1412726400,
    "value": 63711000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 983,
    "time": 1412812800,
    "value": 94407000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 984,
    "time": 1412899200,
    "value": 167515500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 985,
    "time": 1413158400,
    "value": 145405500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 986,
    "time": 1413244800,
    "value": 89052000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 987,
    "time": 1413331200,
    "value": 116542500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 988,
    "time": 1413417600,
    "value": 66036000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 989,
    "time": 1413504000,
    "value": 146335500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 990,
    "time": 1413763200,
    "value": 43081500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 991,
    "time": 1413849600,
    "value": 49818000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 992,
    "time": 1413936000,
    "value": 50922000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 993,
    "time": 1414022400,
    "value": 44418000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 994,
    "time": 1414108800,
    "value": 44964000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 995,
    "time": 1414368000,
    "value": 122512500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 996,
    "time": 1414454400,
    "value": 136755000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 997,
    "time": 1414540800,
    "value": 64392000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 998,
    "time": 1414627200,
    "value": 41557500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 999,
    "time": 1414713600,
    "value": 95433000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1000,
    "time": 1414972800,
    "value": 53284500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1001,
    "time": 1415059200,
    "value": 45828000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1002,
    "time": 1415145600,
    "value": 110295000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1003,
    "time": 1415232000,
    "value": 199843500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1004,
    "time": 1415318400,
    "value": 66370500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1005,
    "time": 1415577600,
    "value": 60531000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1006,
    "time": 1415664000,
    "value": 104346000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1007,
    "time": 1415750400,
    "value": 74176500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1008,
    "time": 1415836800,
    "value": 83121000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1009,
    "time": 1415923200,
    "value": 80746500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1010,
    "time": 1416182400,
    "value": 106527000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1011,
    "time": 1416268800,
    "value": 59107500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1012,
    "time": 1416355200,
    "value": 102915000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1013,
    "time": 1416441600,
    "value": 46186500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1014,
    "time": 1416528000,
    "value": 98868000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1015,
    "time": 1416787200,
    "value": 62733000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1016,
    "time": 1416873600,
    "value": 41280000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1017,
    "time": 1416960000,
    "value": 25401000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1018,
    "time": 1417132800,
    "value": 26473500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1019,
    "time": 1417392000,
    "value": 111850500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1020,
    "time": 1417478400,
    "value": 77887500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1021,
    "time": 1417564800,
    "value": 68868000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1022,
    "time": 1417651200,
    "value": 50370000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1023,
    "time": 1417737600,
    "value": 79653000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1024,
    "time": 1417996800,
    "value": 121050000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1025,
    "time": 1418083200,
    "value": 124179000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1026,
    "time": 1418169600,
    "value": 96352500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1027,
    "time": 1418256000,
    "value": 86691000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1028,
    "time": 1418342400,
    "value": 93274500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1029,
    "time": 1418601600,
    "value": 67555500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1030,
    "time": 1418688000,
    "value": 109290000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1031,
    "time": 1418774400,
    "value": 95917500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1032,
    "time": 1418860800,
    "value": 95482500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1033,
    "time": 1418947200,
    "value": 91818000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1034,
    "time": 1419206400,
    "value": 63783000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1035,
    "time": 1419292800,
    "value": 58047000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1036,
    "time": 1419379200,
    "value": 17316000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1037,
    "time": 1419552000,
    "value": 43195500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1038,
    "time": 1419811200,
    "value": 35398500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1039,
    "time": 1419897600,
    "value": 38286000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1040,
    "time": 1419984000,
    "value": 30895500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1041,
    "time": 1420156800,
    "value": 60666000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1042,
    "time": 1420416000,
    "value": 68766000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1043,
    "time": 1420502400,
    "value": 81739500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1044,
    "time": 1420588800,
    "value": 38506500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1045,
    "time": 1420675200,
    "value": 43804500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1046,
    "time": 1420761600,
    "value": 60375000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1047,
    "time": 1421020800,
    "value": 77257500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1048,
    "time": 1421107200,
    "value": 56380500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1049,
    "time": 1421193600,
    "value": 149176500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1050,
    "time": 1421280000,
    "value": 68364000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1051,
    "time": 1421366400,
    "value": 46059000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1052,
    "time": 1421712000,
    "value": 57217500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1053,
    "time": 1421798400,
    "value": 54037500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1054,
    "time": 1421884800,
    "value": 53611500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1055,
    "time": 1421971200,
    "value": 43978500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1056,
    "time": 1422230400,
    "value": 41752500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1057,
    "time": 1422316800,
    "value": 35581500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1058,
    "time": 1422403200,
    "value": 40210500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1059,
    "time": 1422489600,
    "value": 42373500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1060,
    "time": 1422576000,
    "value": 39295500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1061,
    "time": 1422835200,
    "value": 54160500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1062,
    "time": 1422921600,
    "value": 62689500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1063,
    "time": 1423008000,
    "value": 40846500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1064,
    "time": 1423094400,
    "value": 45030000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1065,
    "time": 1423180800,
    "value": 41568000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1066,
    "time": 1423440000,
    "value": 45162000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1067,
    "time": 1423526400,
    "value": 70638000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1068,
    "time": 1423612800,
    "value": 122290500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1069,
    "time": 1423699200,
    "value": 202587000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1070,
    "time": 1423785600,
    "value": 77947500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1071,
    "time": 1424131200,
    "value": 48615000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1072,
    "time": 1424217600,
    "value": 66528000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1073,
    "time": 1424304000,
    "value": 65745000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1074,
    "time": 1424390400,
    "value": 78301500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1075,
    "time": 1424649600,
    "value": 112644000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1076,
    "time": 1424736000,
    "value": 87600000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1077,
    "time": 1424822400,
    "value": 52257000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1078,
    "time": 1424908800,
    "value": 86088000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1079,
    "time": 1424995200,
    "value": 50161500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1080,
    "time": 1425254400,
    "value": 101004000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1081,
    "time": 1425340800,
    "value": 57592500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1082,
    "time": 1425427200,
    "value": 57156000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1083,
    "time": 1425513600,
    "value": 65712000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1084,
    "time": 1425600000,
    "value": 87417000.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1085,
    "time": 1425859200,
    "value": 87274500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1086,
    "time": 1425945600,
    "value": 69730500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1087,
    "time": 1426032000,
    "value": 64245000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1088,
    "time": 1426118400,
    "value": 53023500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1089,
    "time": 1426204800,
    "value": 67867500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1090,
    "time": 1432598400,
    "value": 43978500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1091,
    "time": 1432684800,
    "value": 43153500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1092,
    "time": 1432771200,
    "value": 44253000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1093,
    "time": 1432857600,
    "value": 49329570.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1094,
    "time": 1433116800,
    "value": 31530225.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1095,
    "time": 1433203200,
    "value": 26885745.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1096,
    "time": 1433289600,
    "value": 22884615.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1097,
    "time": 1433376000,
    "value": 30814980.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1098,
    "time": 1433462400,
    "value": 40628865.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1099,
    "time": 1433721600,
    "value": 65460270.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1100,
    "time": 1433808000,
    "value": 32805165.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1101,
    "time": 1433894400,
    "value": 43567065.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1102,
    "time": 1433980800,
    "value": 26028345.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1103,
    "time": 1434067200,
    "value": 18391890.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1104,
    "time": 1434326400,
    "value": 27654165.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1105,
    "time": 1434412800,
    "value": 24904965.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1106,
    "time": 1434499200,
    "value": 70233015.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1107,
    "time": 1434585600,
    "value": 35891805.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1108,
    "time": 1434672000,
    "value": 32618625.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1109,
    "time": 1434931200,
    "value": 60604575.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1110,
    "time": 1435017600,
    "value": 50767455.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1111,
    "time": 1435104000,
    "value": 29859885.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1112,
    "time": 1435190400,
    "value": 37257870.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1113,
    "time": 1435276800,
    "value": 46306020.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1114,
    "time": 1435536000,
    "value": 44892210.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1115,
    "time": 1435622400,
    "value": 40032600.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1116,
    "time": 1435708800,
    "value": 26522145.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1117,
    "time": 1435795200,
    "value": 89596185.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1118,
    "time": 1436140800,
    "value": 51407370.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1119,
    "time": 1436227200,
    "value": 76788555.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1120,
    "time": 1436313600,
    "value": 77151690.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1121,
    "time": 1436400000,
    "value": 42350805.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1122,
    "time": 1436486400,
    "value": 32995410.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1123,
    "time": 1436745600,
    "value": 37339440.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1124,
    "time": 1436832000,
    "value": 23937300.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1125,
    "time": 1436918400,
    "value": 24810810.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1126,
    "time": 1437004800,
    "value": 19932795.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1127,
    "time": 1437091200,
    "value": 64817235.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1128,
    "time": 1437350400,
    "value": 62984370.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1129,
    "time": 1437436800,
    "value": 76316850.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1130,
    "time": 1437523200,
    "value": 38555175.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1131,
    "time": 1437609600,
    "value": 28486500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1132,
    "time": 1437696000,
    "value": 37048095.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1133,
    "time": 1437955200,
    "value": 60568065.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1134,
    "time": 1438041600,
    "value": 48846450.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1135,
    "time": 1438128000,
    "value": 34009380.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1136,
    "time": 1438214400,
    "value": 26370390.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1137,
    "time": 1438300800,
    "value": 27594270.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1138,
    "time": 1438560000,
    "value": 32603745.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1139,
    "time": 1438646400,
    "value": 28507875.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1140,
    "time": 1438732800,
    "value": 68174265.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1141,
    "time": 1438819200,
    "value": 189249225.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1142,
    "time": 1438905600,
    "value": 67028235.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1143,
    "time": 1439164800,
    "value": 53537460.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1144,
    "time": 1439251200,
    "value": 52796445.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1145,
    "time": 1439337600,
    "value": 46502790.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1146,
    "time": 1439424000,
    "value": 58656540.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1147,
    "time": 1439510400,
    "value": 53596260.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1148,
    "time": 1439769600,
    "value": 88423530.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1149,
    "time": 1439856000,
    "value": 53375535.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1150,
    "time": 1439942400,
    "value": 46379340.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1151,
    "time": 1440028800,
    "value": 62651175.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1152,
    "time": 1440115200,
    "value": 83421645.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1153,
    "time": 1440374400,
    "value": 120938985.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1154,
    "time": 1440460800,
    "value": 53007090.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1155,
    "time": 1440547200,
    "value": 63997230.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1156,
    "time": 1440633600,
    "value": 98315805.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1157,
    "time": 1440720000,
    "value": 71507475.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1158,
    "time": 1440979200,
    "value": 122503890.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1159,
    "time": 1441065600,
    "value": 71484615.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1160,
    "time": 1441152000,
    "value": 61671885.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1161,
    "time": 1441238400,
    "value": 53779770.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1162,
    "time": 1441324800,
    "value": 47893560.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1163,
    "time": 1441670400,
    "value": 40088835.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1164,
    "time": 1441756800,
    "value": 43224345.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1165,
    "time": 1441843200,
    "value": 33505485.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1166,
    "time": 1441929600,
    "value": 30261885.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1167,
    "time": 1442188800,
    "value": 37000215.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1168,
    "time": 1442275200,
    "value": 37735680.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1169,
    "time": 1442361600,
    "value": 53034555.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1170,
    "time": 1442448000,
    "value": 44743740.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1171,
    "time": 1442534400,
    "value": 46208550.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1172,
    "time": 1442793600,
    "value": 78873465.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1173,
    "time": 1442880000,
    "value": 47461185.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1174,
    "time": 1442966400,
    "value": 33568950.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1175,
    "time": 1443052800,
    "value": 43135980.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1176,
    "time": 1443139200,
    "value": 49134375.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1177,
    "time": 1443398400,
    "value": 127229130.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1178,
    "time": 1443484800,
    "value": 47435895.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1179,
    "time": 1443571200,
    "value": 62164515.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1180,
    "time": 1443657600,
    "value": 56504925.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1181,
    "time": 1443744000,
    "value": 54307740.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1182,
    "time": 1444003200,
    "value": 48077100.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1183,
    "time": 1444089600,
    "value": 65567505.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1184,
    "time": 1444176000,
    "value": 89247075.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1185,
    "time": 1444262400,
    "value": 77791965.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1186,
    "time": 1444348800,
    "value": 79845975.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1187,
    "time": 1444608000,
    "value": 49668135.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1188,
    "time": 1444694400,
    "value": 67942260.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1189,
    "time": 1444780800,
    "value": 39930165.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1190,
    "time": 1444867200,
    "value": 36025155.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1191,
    "time": 1444953600,
    "value": 56215725.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1192,
    "time": 1445212800,
    "value": 31590870.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1193,
    "time": 1445299200,
    "value": 197281935.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1194,
    "time": 1445385600,
    "value": 53924745.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1195,
    "time": 1445472000,
    "value": 35633430.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1196,
    "time": 1445558400,
    "value": 54594090.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1197,
    "time": 1445817600,
    "value": 42132645.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1198,
    "time": 1445904000,
    "value": 45352560.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1199,
    "time": 1445990400,
    "value": 34321920.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1200,
    "time": 1446076800,
    "value": 23203560.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1201,
    "time": 1446163200,
    "value": 55364160.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1202,
    "time": 1446422400,
    "value": 49048695.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1203,
    "time": 1446508800,
    "value": 81725865.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1204,
    "time": 1446595200,
    "value": 164936790.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1205,
    "time": 1446681600,
    "value": 57396345.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1206,
    "time": 1446768000,
    "value": 62338770.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1207,
    "time": 1447027200,
    "value": 49130655.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1208,
    "time": 1447113600,
    "value": 58650945.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1209,
    "time": 1447200000,
    "value": 42948015.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1210,
    "time": 1447286400,
    "value": 37479450.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1211,
    "time": 1447372800,
    "value": 42982740.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1212,
    "time": 1447632000,
    "value": 37396095.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1213,
    "time": 1447718400,
    "value": 27685005.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1214,
    "time": 1447804800,
    "value": 36768795.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1215,
    "time": 1447891200,
    "value": 30967155.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1216,
    "time": 1447977600,
    "value": 57603405.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1217,
    "time": 1448236800,
    "value": 31581555.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1218,
    "time": 1448323200,
    "value": 31788765.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1219,
    "time": 1448409600,
    "value": 51472185.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1220,
    "time": 1448582400,
    "value": 24905370.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1221,
    "time": 1448841600,
    "value": 33631095.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1222,
    "time": 1448928000,
    "value": 47844060.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1223,
    "time": 1449014400,
    "value": 37548885.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1224,
    "time": 1449100800,
    "value": 37645980.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1225,
    "time": 1449187200,
    "value": 32882220.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1226,
    "time": 1449446400,
    "value": 40632900.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1227,
    "time": 1449532800,
    "value": 34195545.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1228,
    "time": 1449619200,
    "value": 39684090.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1229,
    "time": 1449705600,
    "value": 26159520.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1230,
    "time": 1449792000,
    "value": 42714765.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1231,
    "time": 1450051200,
    "value": 35973795.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1232,
    "time": 1450137600,
    "value": 28405860.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1233,
    "time": 1450224000,
    "value": 64146990.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1234,
    "time": 1450310400,
    "value": 40449015.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1235,
    "time": 1450396800,
    "value": 38668740.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1236,
    "time": 1450656000,
    "value": 24367620.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1237,
    "time": 1450742400,
    "value": 25559175.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1238,
    "time": 1450828800,
    "value": 18879060.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1239,
    "time": 1450915200,
    "value": 8807865.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1240,
    "time": 1451260800,
    "value": 22891215.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1241,
    "time": 1451347200,
    "value": 31348185.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1242,
    "time": 1451433600,
    "value": 47373570.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1243,
    "time": 1451520000,
    "value": 35687385.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1244,
    "time": 1451865600,
    "value": 84687525.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1245,
    "time": 1451952000,
    "value": 39873360.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1246,
    "time": 1452038400,
    "value": 45644085.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1247,
    "time": 1452124800,
    "value": 44442075.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1248,
    "time": 1452211200,
    "value": 42351450.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1249,
    "time": 1452470400,
    "value": 51419670.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1250,
    "time": 1452556800,
    "value": 37346910.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1251,
    "time": 1452643200,
    "value": 45447780.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1252,
    "time": 1452729600,
    "value": 78481125.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1253,
    "time": 1452816000,
    "value": 65273250.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1254,
    "time": 1453161600,
    "value": 49873515.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1255,
    "time": 1453248000,
    "value": 71760615.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1256,
    "time": 1453334400,
    "value": 39395805.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1257,
    "time": 1453420800,
    "value": 36423510.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1258,
    "time": 1453680000,
    "value": 32746890.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1259,
    "time": 1453766400,
    "value": 61887765.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1260,
    "time": 1453852800,
    "value": 43610685.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1261,
    "time": 1453939200,
    "value": 58177335.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1262,
    "time": 1454025600,
    "value": 36289005.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1263,
    "time": 1454284800,
    "value": 67881600.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1264,
    "time": 1454371200,
    "value": 72660375.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1265,
    "time": 1454457600,
    "value": 102199185.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1266,
    "time": 1454544000,
    "value": 55556535.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1267,
    "time": 1454630400,
    "value": 121217820.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1268,
    "time": 1454889600,
    "value": 117036630.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1269,
    "time": 1454976000,
    "value": 111349140.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1270,
    "time": 1455062400,
    "value": 114878790.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1271,
    "time": 1455148800,
    "value": 187276440.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1272,
    "time": 1455235200,
    "value": 95316150.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1273,
    "time": 1455580800,
    "value": 72728055.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1274,
    "time": 1455667200,
    "value": 76193205.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1275,
    "time": 1455753600,
    "value": 49621590.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1276,
    "time": 1455840000,
    "value": 36965385.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1277,
    "time": 1456099200,
    "value": 66003810.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1278,
    "time": 1456185600,
    "value": 69213390.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1279,
    "time": 1456272000,
    "value": 69879090.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1280,
    "time": 1456358400,
    "value": 67942905.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1281,
    "time": 1456444800,
    "value": 78149805.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1282,
    "time": 1456704000,
    "value": 115657890.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1283,
    "time": 1456790400,
    "value": 87616590.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1284,
    "time": 1456876800,
    "value": 62262495.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1285,
    "time": 1456963200,
    "value": 63760695.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1286,
    "time": 1457049600,
    "value": 86046540.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1287,
    "time": 1457308800,
    "value": 67046235.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1288,
    "time": 1457395200,
    "value": 53949945.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1289,
    "time": 1457481600,
    "value": 41877810.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1290,
    "time": 1457568000,
    "value": 67059180.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1291,
    "time": 1457654400,
    "value": 42624135.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1292,
    "time": 1457913600,
    "value": 50652270.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1293,
    "time": 1458000000,
    "value": 80336310.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1294,
    "time": 1458086400,
    "value": 45207405.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1295,
    "time": 1458172800,
    "value": 48334365.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1296,
    "time": 1458259200,
    "value": 59588040.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1297,
    "time": 1458518400,
    "value": 66283815.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1298,
    "time": 1458604800,
    "value": 53471670.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1299,
    "time": 1458691200,
    "value": 62026500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1300,
    "time": 1458777600,
    "value": 64368510.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1301,
    "time": 1459123200,
    "value": 49788900.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1302,
    "time": 1459209600,
    "value": 51507480.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1303,
    "time": 1459296000,
    "value": 52204845.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1304,
    "time": 1459382400,
    "value": 103025805.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1305,
    "time": 1459468800,
    "value": 205378890.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1306,
    "time": 1459728000,
    "value": 169088775.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1307,
    "time": 1459814400,
    "value": 127513170.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1308,
    "time": 1459900800,
    "value": 143856135.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1309,
    "time": 1459987200,
    "value": 111640635.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1310,
    "time": 1460073600,
    "value": 92146575.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1311,
    "time": 1460332800,
    "value": 119938500.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1312,
    "time": 1460419200,
    "value": 73495020.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1313,
    "time": 1460505600,
    "value": 63754965.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1314,
    "time": 1460592000,
    "value": 53539065.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1315,
    "time": 1460678400,
    "value": 47150220.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1316,
    "time": 1460937600,
    "value": 56465895.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1317,
    "time": 1461024000,
    "value": 80956815.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1318,
    "time": 1461110400,
    "value": 67998930.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1319,
    "time": 1461196800,
    "value": 36160305.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1320,
    "time": 1461283200,
    "value": 50184240.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1321,
    "time": 1461542400,
    "value": 46018590.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1322,
    "time": 1461628800,
    "value": 41643750.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1323,
    "time": 1461715200,
    "value": 41368650.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1324,
    "time": 1461801600,
    "value": 31875060.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1325,
    "time": 1461888000,
    "value": 67850040.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1326,
    "time": 1462147200,
    "value": 48718935.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1327,
    "time": 1462233600,
    "value": 54099555.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1328,
    "time": 1462320000,
    "value": 101952825.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1329,
    "time": 1462406400,
    "value": 140309865.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1330,
    "time": 1462492800,
    "value": 74756025.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1331,
    "time": 1462752000,
    "value": 62450460.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1332,
    "time": 1462838400,
    "value": 51794940.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1333,
    "time": 1462924800,
    "value": 61181340.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1334,
    "time": 1463011200,
    "value": 46360335.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1335,
    "time": 1463097600,
    "value": 35990505.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1336,
    "time": 1463356800,
    "value": 37083990.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1337,
    "time": 1463443200,
    "value": 34568325.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1338,
    "time": 1463529600,
    "value": 69813285.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1339,
    "time": 1463616000,
    "value": 86109435.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1340,
    "time": 1463702400,
    "value": 113611050.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1341,
    "time": 1463961600,
    "value": 66618810.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1342,
    "time": 1464048000,
    "value": 37793115.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1343,
    "time": 1464134400,
    "value": 37445070.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1344,
    "time": 1464220800,
    "value": 53304360.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1345,
    "time": 1464307200,
    "value": 47011290.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1346,
    "time": 1464652800,
    "value": 31549200.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1347,
    "time": 1464739200,
    "value": 38188845.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1348,
    "time": 1464825600,
    "value": 24582015.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1349,
    "time": 1464912000,
    "value": 28329450.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1350,
    "time": 1465171200,
    "value": 28419060.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1351,
    "time": 1465257600,
    "value": 80287470.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1352,
    "time": 1465344000,
    "value": 76060455.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1353,
    "time": 1465430400,
    "value": 58262070.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1354,
    "time": 1465516800,
    "value": 78597060.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1355,
    "time": 1465776000,
    "value": 53577120.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1356,
    "time": 1465862400,
    "value": 44983245.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1357,
    "time": 1465948800,
    "value": 36963330.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1358,
    "time": 1466035200,
    "value": 31423200.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1359,
    "time": 1466121600,
    "value": 38441865.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1360,
    "time": 1466380800,
    "value": 44990895.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1361,
    "time": 1466467200,
    "value": 41360595.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1362,
    "time": 1466553600,
    "value": 288062460.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1363,
    "time": 1466640000,
    "value": 122422515.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1364,
    "time": 1466726400,
    "value": 83003595.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1365,
    "time": 1466985600,
    "value": 90248895.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1366,
    "time": 1467072000,
    "value": 69636630.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1367,
    "time": 1467158400,
    "value": 70308465.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1368,
    "time": 1467244800,
    "value": 56418435.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1369,
    "time": 1467331200,
    "value": 63605955.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1370,
    "time": 1467676800,
    "value": 64103865.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1371,
    "time": 1467763200,
    "value": 56001630.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1372,
    "time": 1467849600,
    "value": 41651820.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1373,
    "time": 1467936000,
    "value": 45595800.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1374,
    "time": 1468195200,
    "value": 66368370.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1375,
    "time": 1468281600,
    "value": 56701455.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1376,
    "time": 1468368000,
    "value": 44640195.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1377,
    "time": 1468454400,
    "value": 32683545.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1378,
    "time": 1468540800,
    "value": 28054815.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1379,
    "time": 1468800000,
    "value": 43574475.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1380,
    "time": 1468886400,
    "value": 36414315.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1381,
    "time": 1468972800,
    "value": 31636800.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1382,
    "time": 1469059200,
    "value": 55197015.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1383,
    "time": 1469145600,
    "value": 32939685.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1384,
    "time": 1469404800,
    "value": 57810465.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1385,
    "time": 1469491200,
    "value": 39602580.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1386,
    "time": 1469577600,
    "value": 35585460.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1387,
    "time": 1469664000,
    "value": 29429970.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1388,
    "time": 1469750400,
    "value": 38264985.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1389,
    "time": 1470009600,
    "value": 51807975.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1390,
    "time": 1470096000,
    "value": 48089565.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1391,
    "time": 1470182400,
    "value": 49846905.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1392,
    "time": 1470268800,
    "value": 52533225.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1393,
    "time": 1470355200,
    "value": 38675430.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1394,
    "time": 1470614400,
    "value": 27615555.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1395,
    "time": 1470700800,
    "value": 26310885.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1396,
    "time": 1470787200,
    "value": 28483890.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1397,
    "time": 1470873600,
    "value": 24076710.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1398,
    "time": 1470960000,
    "value": 20300850.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1399,
    "time": 1471219200,
    "value": 25273980.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1400,
    "time": 1471305600,
    "value": 26379855.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1401,
    "time": 1471392000,
    "value": 21790455.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1402,
    "time": 1471478400,
    "value": 20870070.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1403,
    "time": 1471564800,
    "value": 19653315.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1404,
    "time": 1471824000,
    "value": 26019900.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1405,
    "time": 1471910400,
    "value": 63281610.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1406,
    "time": 1471996800,
    "value": 30888090.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1407,
    "time": 1472083200,
    "value": 21926385.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1408,
    "time": 1472169600,
    "value": 28345545.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1409,
    "time": 1472428800,
    "value": 41806380.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1410,
    "time": 1472515200,
    "value": 39825960.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1411,
    "time": 1472601600,
    "value": 40418205.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1412,
    "time": 1472688000,
    "value": 102308160.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1413,
    "time": 1472774400,
    "value": 74876685.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1414,
    "time": 1473120000,
    "value": 54042450.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1415,
    "time": 1473206400,
    "value": 44694975.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1416,
    "time": 1473292800,
    "value": 41787750.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1417,
    "time": 1473379200,
    "value": 48325905.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1418,
    "time": 1473638400,
    "value": 45839700.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1419,
    "time": 1473724800,
    "value": 44783100.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1420,
    "time": 1473811200,
    "value": 28667115.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1421,
    "time": 1473897600,
    "value": 36054000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1422,
    "time": 1473984000,
    "value": 38842110.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1423,
    "time": 1474243200,
    "value": 28640355.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1424,
    "time": 1474329600,
    "value": 24932340.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1425,
    "time": 1474416000,
    "value": 31800480.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1426,
    "time": 1474502400,
    "value": 29451975.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1427,
    "time": 1474588800,
    "value": 33538245.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1428,
    "time": 1474848000,
    "value": 28243755.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1429,
    "time": 1474934400,
    "value": 39862860.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1430,
    "time": 1475020800,
    "value": 27330960.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1431,
    "time": 1475107200,
    "value": 35370465.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1432,
    "time": 1475193600,
    "value": 33940980.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1433,
    "time": 1475452800,
    "value": 80238360.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1434,
    "time": 1475539200,
    "value": 45776940.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1435,
    "time": 1475625600,
    "value": 23797215.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1436,
    "time": 1475712000,
    "value": 61862850.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1437,
    "time": 1475798400,
    "value": 44352930.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1438,
    "time": 1476057600,
    "value": 43733445.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1439,
    "time": 1476144000,
    "value": 30339060.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1440,
    "time": 1476230400,
    "value": 24088650.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1441,
    "time": 1476316800,
    "value": 28215435.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1442,
    "time": 1476403200,
    "value": 57088020.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1443,
    "time": 1476662400,
    "value": 59920515.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1444,
    "time": 1476748800,
    "value": 77545620.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1445,
    "time": 1476835200,
    "value": 94281555.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1446,
    "time": 1476921600,
    "value": 65298930.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1447,
    "time": 1477008000,
    "value": 37628655.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1448,
    "time": 1477267200,
    "value": 35458005.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1449,
    "time": 1477353600,
    "value": 28966155.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1450,
    "time": 1477440000,
    "value": 75116040.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1451,
    "time": 1477526400,
    "value": 175683330.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1452,
    "time": 1477612800,
    "value": 57461385.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1453,
    "time": 1477872000,
    "value": 56721510.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1454,
    "time": 1477958400,
    "value": 89997060.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1455,
    "time": 1478044800,
    "value": 54515745.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1456,
    "time": 1478131200,
    "value": 32900445.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1457,
    "time": 1478217600,
    "value": 65781930.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1458,
    "time": 1478476800,
    "value": 50097405.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1459,
    "time": 1478563200,
    "value": 42242490.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1460,
    "time": 1478649600,
    "value": 103742010.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1461,
    "time": 1478736000,
    "value": 84858330.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1462,
    "time": 1478822400,
    "value": 51611205.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1463,
    "time": 1479081600,
    "value": 85608450.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1464,
    "time": 1479168000,
    "value": 50682225.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1465,
    "time": 1479254400,
    "value": 41321985.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1466,
    "time": 1479340800,
    "value": 57600180.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1467,
    "time": 1479427200,
    "value": 67142955.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1468,
    "time": 1479686400,
    "value": 57124485.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1469,
    "time": 1479772800,
    "value": 73593240.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1470,
    "time": 1479859200,
    "value": 62876265.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1471,
    "time": 1480032000,
    "value": 30619665.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1472,
    "time": 1480291200,
    "value": 58714410.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1473,
    "time": 1480377600,
    "value": 57520620.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1474,
    "time": 1480464000,
    "value": 45849390.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1475,
    "time": 1480550400,
    "value": 65228070.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1476,
    "time": 1480636800,
    "value": 51604950.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1477,
    "time": 1480896000,
    "value": 50948565.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1478,
    "time": 1480982400,
    "value": 44166465.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1479,
    "time": 1481068800,
    "value": 71439045.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1480,
    "time": 1481155200,
    "value": 40960065.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1481,
    "time": 1481241600,
    "value": 33890505.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1482,
    "time": 1481500800,
    "value": 31229640.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1483,
    "time": 1481587200,
    "value": 89130030.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1484,
    "time": 1481673600,
    "value": 54654495.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1485,
    "time": 1481760000,
    "value": 41365305.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1486,
    "time": 1481846400,
    "value": 49030395.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1487,
    "time": 1482105600,
    "value": 45378420.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0": 1488,
    "time": 1482192000,
    "value": 62280810.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0": 1489,
    "time": 1482278400,
    "value": 69526095.0,
    "color": "rgba(200,127,130,0.8)"
  }
])

            if (!window.dloqqrvj.chart.priceScale("right").options.autoScale)
                window.dloqqrvj.chart.priceScale("right").applyOptions({autoScale: true})
        
window.dloqqrvj.toolBox?.clearDrawings()
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 0,
  "time": 1482364800.0,
  "open": 13.8093,
  "high": 13.9993,
  "low": 13.7667,
  "close": 13.91,
  "volume": 40609665.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 0,
  "time": 1482364800.0,
  "value": 40609665.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 1,
  "time": 1482451200.0,
  "open": 13.8667,
  "high": 14.2667,
  "low": 13.8473,
  "close": 14.2533,
  "volume": 57488535.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 1,
  "time": 1482451200.0,
  "value": 57488535.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 2,
  "time": 1482796800.0,
  "open": 14.2033,
  "high": 14.8167,
  "low": 14.1867,
  "close": 14.6533,
  "volume": 76603605.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 2,
  "time": 1482796800.0,
  "value": 76603605.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 3,
  "time": 1482883200.0,
  "open": 14.6667,
  "high": 14.92,
  "low": 14.48,
  "close": 14.616,
  "volume": 48715005.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 3,
  "time": 1482883200.0,
  "value": 48715005.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 4,
  "time": 1482969600.0,
  "open": 14.65,
  "high": 14.6667,
  "low": 14.2747,
  "close": 14.3107,
  "volume": 53864715.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 4,
  "time": 1482969600.0,
  "value": 53864715.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 5,
  "time": 1483056000.0,
  "open": 14.338,
  "high": 14.5,
  "low": 14.112,
  "close": 14.236,
  "volume": 61296165.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 5,
  "time": 1483056000.0,
  "value": 61296165.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 6,
  "time": 1483401600.0,
  "open": 14.2507,
  "high": 14.6887,
  "low": 13.8,
  "close": 14.1893,
  "volume": 76751040.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 6,
  "time": 1483401600.0,
  "value": 76751040.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 7,
  "time": 1483488000.0,
  "open": 14.2,
  "high": 15.2,
  "low": 14.0747,
  "close": 15.1067,
  "volume": 148240920.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 7,
  "time": 1483488000.0,
  "value": 148240920.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 8,
  "time": 1483574400.0,
  "open": 14.9253,
  "high": 15.1653,
  "low": 14.7967,
  "close": 15.13,
  "volume": 48295200.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 8,
  "time": 1483574400.0,
  "value": 48295200.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 9,
  "time": 1483660800.0,
  "open": 15.1167,
  "high": 15.354,
  "low": 15.03,
  "close": 15.264,
  "volume": 72480600.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 9,
  "time": 1483660800.0,
  "value": 72480600.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 10,
  "time": 1483920000.0,
  "open": 15.2667,
  "high": 15.4613,
  "low": 15.2,
  "close": 15.4187,
  "volume": 51153120.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 10,
  "time": 1483920000.0,
  "value": 51153120.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 11,
  "time": 1484006400.0,
  "open": 15.4007,
  "high": 15.4667,
  "low": 15.126,
  "close": 15.3,
  "volume": 47673600.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 11,
  "time": 1484006400.0,
  "value": 47673600.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 12,
  "time": 1484092800.0,
  "open": 15.2667,
  "high": 15.334,
  "low": 15.112,
  "close": 15.31,
  "volume": 45848955.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 12,
  "time": 1484092800.0,
  "value": 45848955.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 13,
  "time": 1484179200.0,
  "open": 15.2687,
  "high": 15.38,
  "low": 15.0387,
  "close": 15.2933,
  "volume": 47768535.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 13,
  "time": 1484179200.0,
  "value": 47768535.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 14,
  "time": 1484265600.0,
  "open": 15.3333,
  "high": 15.8567,
  "low": 15.2733,
  "close": 15.85,
  "volume": 80412510.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 14,
  "time": 1484265600.0,
  "value": 80412510.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 15,
  "time": 1484611200.0,
  "open": 15.7607,
  "high": 15.9973,
  "low": 15.6247,
  "close": 15.7053,
  "volume": 59745210.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 15,
  "time": 1484611200.0,
  "value": 59745210.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 16,
  "time": 1484697600.0,
  "open": 15.7027,
  "high": 15.9807,
  "low": 15.7027,
  "close": 15.9147,
  "volume": 48709860.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 16,
  "time": 1484697600.0,
  "value": 48709860.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 17,
  "time": 1484784000.0,
  "open": 16.4073,
  "high": 16.5787,
  "low": 16.05,
  "close": 16.1767,
  "volume": 101214150.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 17,
  "time": 1484784000.0,
  "value": 101214150.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 18,
  "time": 1484870400.0,
  "open": 16.3167,
  "high": 16.4,
  "low": 16.2007,
  "close": 16.32,
  "volume": 49923165.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 18,
  "time": 1484870400.0,
  "value": 49923165.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 19,
  "time": 1485129600.0,
  "open": 16.31,
  "high": 16.726,
  "low": 16.2733,
  "close": 16.598,
  "volume": 78557610.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 19,
  "time": 1485129600.0,
  "value": 78557610.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 20,
  "time": 1485216000.0,
  "open": 16.5553,
  "high": 16.9993,
  "low": 16.5553,
  "close": 16.9993,
  "volume": 62280870.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 20,
  "time": 1485216000.0,
  "value": 62280870.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 21,
  "time": 1485302400.0,
  "open": 17.0667,
  "high": 17.2307,
  "low": 16.7867,
  "close": 16.96,
  "volume": 65941140.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 21,
  "time": 1485302400.0,
  "value": 65941140.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 22,
  "time": 1485388800.0,
  "open": 16.9887,
  "high": 17.0493,
  "low": 16.7167,
  "close": 16.742,
  "volume": 39469215.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 22,
  "time": 1485388800.0,
  "value": 39469215.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 23,
  "time": 1485475200.0,
  "open": 16.798,
  "high": 16.9853,
  "low": 16.568,
  "close": 16.9267,
  "volume": 39775995.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 23,
  "time": 1485475200.0,
  "value": 39775995.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 24,
  "time": 1485734400.0,
  "open": 16.8633,
  "high": 17.0193,
  "low": 16.4733,
  "close": 16.688,
  "volume": 48218610.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 24,
  "time": 1485734400.0,
  "value": 48218610.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 25,
  "time": 1485820800.0,
  "open": 16.67,
  "high": 17.0593,
  "low": 16.5133,
  "close": 16.8133,
  "volume": 52682265.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 25,
  "time": 1485820800.0,
  "value": 52682265.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 26,
  "time": 1485907200.0,
  "open": 16.8767,
  "high": 16.9327,
  "low": 16.6033,
  "close": 16.6167,
  "volume": 51352470.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 26,
  "time": 1485907200.0,
  "value": 51352470.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 27,
  "time": 1485993600.0,
  "open": 16.5333,
  "high": 16.828,
  "low": 16.4993,
  "close": 16.684,
  "volume": 31979490.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 27,
  "time": 1485993600.0,
  "value": 31979490.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 28,
  "time": 1486080000.0,
  "open": 16.7533,
  "high": 16.8527,
  "low": 16.6453,
  "close": 16.764,
  "volume": 24938490.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 28,
  "time": 1486080000.0,
  "value": 24938490.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 29,
  "time": 1486339200.0,
  "open": 16.7907,
  "high": 17.2027,
  "low": 16.6807,
  "close": 17.2027,
  "volume": 45616860.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 29,
  "time": 1486339200.0,
  "value": 45616860.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 30,
  "time": 1486425600.0,
  "open": 17.1667,
  "high": 17.3333,
  "low": 17.0947,
  "close": 17.1653,
  "volume": 52628640.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 30,
  "time": 1486425600.0,
  "value": 52628640.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 31,
  "time": 1486512000.0,
  "open": 17.1833,
  "high": 17.666,
  "low": 17.08,
  "close": 17.6493,
  "volume": 50357010.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 31,
  "time": 1486512000.0,
  "value": 50357010.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 32,
  "time": 1486598400.0,
  "open": 17.638,
  "high": 18.3333,
  "low": 17.472,
  "close": 17.95,
  "volume": 101696130.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 32,
  "time": 1486598400.0,
  "value": 101696130.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 33,
  "time": 1486684800.0,
  "open": 18.0,
  "high": 18.0887,
  "low": 17.7407,
  "close": 17.934,
  "volume": 46664505.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 33,
  "time": 1486684800.0,
  "value": 46664505.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 34,
  "time": 1486944000.0,
  "open": 18.0067,
  "high": 18.7333,
  "low": 17.9807,
  "close": 18.73,
  "volume": 91768200.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 34,
  "time": 1486944000.0,
  "value": 91768200.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 35,
  "time": 1487030400.0,
  "open": 18.7333,
  "high": 19.1593,
  "low": 18.574,
  "close": 18.732,
  "volume": 94881045.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 35,
  "time": 1487030400.0,
  "value": 94881045.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 36,
  "time": 1487116800.0,
  "open": 18.6747,
  "high": 18.816,
  "low": 18.4293,
  "close": 18.6467,
  "volume": 63557535.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 36,
  "time": 1487116800.0,
  "value": 63557535.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 37,
  "time": 1487203200.0,
  "open": 18.5707,
  "high": 18.6667,
  "low": 17.734,
  "close": 17.8333,
  "volume": 89172345.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 37,
  "time": 1487203200.0,
  "value": 89172345.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 38,
  "time": 1487289600.0,
  "open": 17.5933,
  "high": 18.1927,
  "low": 17.51,
  "close": 18.124,
  "volume": 81886155.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 38,
  "time": 1487289600.0,
  "value": 81886155.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 39,
  "time": 1487635200.0,
  "open": 18.22,
  "high": 18.76,
  "low": 18.1487,
  "close": 18.6,
  "volume": 71768040.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 39,
  "time": 1487635200.0,
  "value": 71768040.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 40,
  "time": 1487721600.0,
  "open": 18.5333,
  "high": 18.8967,
  "low": 18.1733,
  "close": 18.5113,
  "volume": 113085195.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 40,
  "time": 1487721600.0,
  "value": 113085195.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 41,
  "time": 1487808000.0,
  "open": 18.6067,
  "high": 18.6467,
  "low": 17.0,
  "close": 17.0,
  "volume": 193472580.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 41,
  "time": 1487808000.0,
  "value": 193472580.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 42,
  "time": 1487894400.0,
  "open": 17.0,
  "high": 17.2167,
  "low": 16.68,
  "close": 17.1133,
  "volume": 107111355.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 42,
  "time": 1487894400.0,
  "value": 107111355.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 43,
  "time": 1488153600.0,
  "open": 17.4007,
  "high": 17.4333,
  "low": 16.134,
  "close": 16.3867,
  "volume": 150069720.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 43,
  "time": 1488153600.0,
  "value": 150069720.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 44,
  "time": 1488240000.0,
  "open": 16.2933,
  "high": 16.7333,
  "low": 16.26,
  "close": 16.692,
  "volume": 78670740.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 44,
  "time": 1488240000.0,
  "value": 78670740.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 45,
  "time": 1488326400.0,
  "open": 16.7927,
  "high": 17.0,
  "low": 16.6073,
  "close": 16.6553,
  "volume": 61044060.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 45,
  "time": 1488326400.0,
  "value": 61044060.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 46,
  "time": 1488412800.0,
  "open": 16.7,
  "high": 16.8853,
  "low": 16.5513,
  "close": 16.6707,
  "volume": 44183175.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 46,
  "time": 1488412800.0,
  "value": 44183175.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 47,
  "time": 1488499200.0,
  "open": 16.62,
  "high": 16.8,
  "low": 16.6,
  "close": 16.75,
  "volume": 38606160.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 47,
  "time": 1488499200.0,
  "value": 38606160.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 48,
  "time": 1488758400.0,
  "open": 16.7033,
  "high": 16.78,
  "low": 16.3593,
  "close": 16.7567,
  "volume": 43940415.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 48,
  "time": 1488758400.0,
  "value": 43940415.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 49,
  "time": 1488844800.0,
  "open": 16.726,
  "high": 16.926,
  "low": 16.4807,
  "close": 16.5333,
  "volume": 43656195.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 49,
  "time": 1488844800.0,
  "value": 43656195.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 50,
  "time": 1488931200.0,
  "open": 16.5793,
  "high": 16.6713,
  "low": 16.3547,
  "close": 16.4593,
  "volume": 47784270.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 50,
  "time": 1488931200.0,
  "value": 47784270.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 51,
  "time": 1489017600.0,
  "open": 16.4833,
  "high": 16.5773,
  "low": 16.2,
  "close": 16.3533,
  "volume": 50291415.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 51,
  "time": 1489017600.0,
  "value": 50291415.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 52,
  "time": 1489104000.0,
  "open": 16.4,
  "high": 16.4933,
  "low": 16.2,
  "close": 16.2473,
  "volume": 40420680.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 52,
  "time": 1489104000.0,
  "value": 40420680.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 53,
  "time": 1489363200.0,
  "open": 16.1907,
  "high": 16.506,
  "low": 16.1853,
  "close": 16.4533,
  "volume": 38125545.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 53,
  "time": 1489363200.0,
  "value": 38125545.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 54,
  "time": 1489449600.0,
  "open": 16.4373,
  "high": 17.2867,
  "low": 16.38,
  "close": 17.2667,
  "volume": 100832040.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 54,
  "time": 1489449600.0,
  "value": 100832040.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 55,
  "time": 1489536000.0,
  "open": 17.2533,
  "high": 17.6467,
  "low": 16.7073,
  "close": 17.402,
  "volume": 69533460.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 55,
  "time": 1489536000.0,
  "value": 69533460.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 56,
  "time": 1489622400.0,
  "open": 17.4067,
  "high": 17.7167,
  "low": 17.2707,
  "close": 17.4667,
  "volume": 90819975.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 56,
  "time": 1489622400.0,
  "value": 90819975.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 57,
  "time": 1489708800.0,
  "open": 17.48,
  "high": 17.6887,
  "low": 17.4053,
  "close": 17.41,
  "volume": 80565870.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 57,
  "time": 1489708800.0,
  "value": 80565870.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 58,
  "time": 1489968000.0,
  "open": 17.4167,
  "high": 17.6367,
  "low": 17.2547,
  "close": 17.4633,
  "volume": 46284510.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 58,
  "time": 1489968000.0,
  "value": 46284510.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 59,
  "time": 1490054400.0,
  "open": 17.4867,
  "high": 17.6533,
  "low": 16.6827,
  "close": 16.7253,
  "volume": 90363240.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 59,
  "time": 1490054400.0,
  "value": 90363240.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 60,
  "time": 1490140800.0,
  "open": 16.6667,
  "high": 17.0327,
  "low": 16.6333,
  "close": 16.9853,
  "volume": 50458350.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 60,
  "time": 1490140800.0,
  "value": 50458350.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 61,
  "time": 1490227200.0,
  "open": 17.0367,
  "high": 17.1787,
  "low": 16.8867,
  "close": 16.972,
  "volume": 42898545.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 61,
  "time": 1490227200.0,
  "value": 42898545.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 62,
  "time": 1490313600.0,
  "open": 17.0067,
  "high": 17.5927,
  "low": 17.0007,
  "close": 17.5913,
  "volume": 74085210.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 62,
  "time": 1490313600.0,
  "value": 74085210.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 63,
  "time": 1490572800.0,
  "open": 17.5333,
  "high": 18.1267,
  "low": 17.3167,
  "close": 18.1,
  "volume": 80728845.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 63,
  "time": 1490572800.0,
  "value": 80728845.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 64,
  "time": 1490659200.0,
  "open": 18.0667,
  "high": 18.712,
  "low": 17.8667,
  "close": 18.5833,
  "volume": 102388365.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 64,
  "time": 1490659200.0,
  "value": 102388365.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 65,
  "time": 1490745600.0,
  "open": 18.5947,
  "high": 18.64,
  "low": 18.3693,
  "close": 18.4833,
  "volume": 46356210.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 65,
  "time": 1490745600.0,
  "value": 46356210.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 66,
  "time": 1490832000.0,
  "open": 18.484,
  "high": 18.8,
  "low": 18.4807,
  "close": 18.5333,
  "volume": 53993670.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 66,
  "time": 1490832000.0,
  "value": 53993670.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 67,
  "time": 1490918400.0,
  "open": 18.512,
  "high": 18.6593,
  "low": 18.4207,
  "close": 18.542,
  "volume": 41612610.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 67,
  "time": 1490918400.0,
  "value": 41612610.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 68,
  "time": 1491177600.0,
  "open": 18.75,
  "high": 19.9333,
  "low": 18.5533,
  "close": 19.9013,
  "volume": 180777570.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 68,
  "time": 1491177600.0,
  "value": 180777570.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 69,
  "time": 1491264000.0,
  "open": 19.9333,
  "high": 20.3207,
  "low": 19.6353,
  "close": 20.1333,
  "volume": 129370695.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 69,
  "time": 1491264000.0,
  "value": 129370695.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.setMarkers([{"time": 1491264000.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}])
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 70,
  "time": 1491350400.0,
  "open": 20.2467,
  "high": 20.3253,
  "low": 19.6133,
  "close": 19.6833,
  "volume": 99987900.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 70,
  "time": 1491350400.0,
  "value": 99987900.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 71,
  "time": 1491436800.0,
  "open": 19.5933,
  "high": 20.1293,
  "low": 19.534,
  "close": 19.9247,
  "volume": 71159910.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 71,
  "time": 1491436800.0,
  "value": 71159910.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 72,
  "time": 1491523200.0,
  "open": 19.9233,
  "high": 20.1967,
  "low": 19.674,
  "close": 20.1753,
  "volume": 57513600.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 72,
  "time": 1491523200.0,
  "value": 57513600.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.setMarkers([{"time": 1491264000.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}, {"time": 1491523200.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}])
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 73,
  "time": 1491782400.0,
  "open": 20.3067,
  "high": 20.9153,
  "low": 20.3067,
  "close": 20.8147,
  "volume": 97980315.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 73,
  "time": 1491782400.0,
  "value": 97980315.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 74,
  "time": 1491868800.0,
  "open": 20.8907,
  "high": 20.902,
  "low": 20.3667,
  "close": 20.5533,
  "volume": 72841680.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 74,
  "time": 1491868800.0,
  "value": 72841680.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 75,
  "time": 1491955200.0,
  "open": 20.6,
  "high": 20.6433,
  "low": 19.744,
  "close": 19.8187,
  "volume": 76993785.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 75,
  "time": 1491955200.0,
  "value": 76993785.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 76,
  "time": 1492041600.0,
  "open": 19.6587,
  "high": 20.4927,
  "low": 19.5667,
  "close": 20.2713,
  "volume": 124106325.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 76,
  "time": 1492041600.0,
  "value": 124106325.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.setMarkers([{"time": 1491264000.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}, {"time": 1491523200.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}, {"time": 1492041600.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}])
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 77,
  "time": 1492387200.0,
  "open": 20.2833,
  "high": 20.2833,
  "low": 19.912,
  "close": 20.008,
  "volume": 53491485.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 77,
  "time": 1492387200.0,
  "value": 53491485.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 78,
  "time": 1492473600.0,
  "open": 20.0327,
  "high": 20.056,
  "low": 19.8393,
  "close": 20.0,
  "volume": 38393445.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 78,
  "time": 1492473600.0,
  "value": 38393445.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 79,
  "time": 1492560000.0,
  "open": 20.0133,
  "high": 20.4413,
  "low": 20.0133,
  "close": 20.3373,
  "volume": 49679670.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 79,
  "time": 1492560000.0,
  "value": 49679670.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 80,
  "time": 1492646400.0,
  "open": 20.4,
  "high": 20.61,
  "low": 20.0153,
  "close": 20.15,
  "volume": 78870705.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 80,
  "time": 1492646400.0,
  "value": 78870705.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 81,
  "time": 1492732800.0,
  "open": 20.1867,
  "high": 20.4593,
  "low": 20.028,
  "close": 20.4447,
  "volume": 57667530.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 81,
  "time": 1492732800.0,
  "value": 57667530.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 82,
  "time": 1492992000.0,
  "open": 20.6667,
  "high": 20.7033,
  "low": 20.4013,
  "close": 20.5153,
  "volume": 65769240.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 82,
  "time": 1492992000.0,
  "value": 65769240.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 83,
  "time": 1493078400.0,
  "open": 20.5667,
  "high": 20.932,
  "low": 20.3907,
  "close": 20.9167,
  "volume": 85255320.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 83,
  "time": 1493078400.0,
  "value": 85255320.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 84,
  "time": 1493164800.0,
  "open": 20.876,
  "high": 20.9667,
  "low": 20.6,
  "close": 20.6673,
  "volume": 54209820.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 84,
  "time": 1493164800.0,
  "value": 54209820.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 85,
  "time": 1493251200.0,
  "open": 20.66,
  "high": 20.8727,
  "low": 20.5,
  "close": 20.6067,
  "volume": 44895480.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 85,
  "time": 1493251200.0,
  "value": 44895480.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 86,
  "time": 1493337600.0,
  "open": 20.6527,
  "high": 21.0073,
  "low": 20.5333,
  "close": 20.9733,
  "volume": 58899975.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 86,
  "time": 1493337600.0,
  "value": 58899975.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 87,
  "time": 1493596800.0,
  "open": 20.9993,
  "high": 21.8167,
  "low": 20.938,
  "close": 21.5967,
  "volume": 108803550.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 87,
  "time": 1493596800.0,
  "value": 108803550.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 88,
  "time": 1493683200.0,
  "open": 21.492,
  "high": 21.844,
  "low": 21.1,
  "close": 21.1667,
  "volume": 67132200.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 88,
  "time": 1493683200.0,
  "value": 67132200.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 89,
  "time": 1493769600.0,
  "open": 21.2167,
  "high": 21.4353,
  "low": 20.0733,
  "close": 20.2467,
  "volume": 88490685.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 89,
  "time": 1493769600.0,
  "value": 88490685.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 90,
  "time": 1493856000.0,
  "open": 20.34,
  "high": 20.56,
  "low": 19.384,
  "close": 19.7253,
  "volume": 178937325.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 90,
  "time": 1493856000.0,
  "value": 178937325.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 91,
  "time": 1493942400.0,
  "open": 19.7907,
  "high": 20.6,
  "low": 19.7373,
  "close": 20.6,
  "volume": 103262310.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 91,
  "time": 1493942400.0,
  "value": 103262310.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.setMarkers([{"time": 1491264000.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}, {"time": 1491523200.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}, {"time": 1492041600.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}, {"time": 1493942400.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}])
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 92,
  "time": 1494201600.0,
  "open": 20.6433,
  "high": 20.9193,
  "low": 20.388,
  "close": 20.5053,
  "volume": 91822080.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 92,
  "time": 1494201600.0,
  "value": 91822080.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 93,
  "time": 1494288000.0,
  "open": 20.55,
  "high": 21.466,
  "low": 20.55,
  "close": 21.3467,
  "volume": 124801560.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 93,
  "time": 1494288000.0,
  "value": 124801560.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 94,
  "time": 1494374400.0,
  "open": 21.6,
  "high": 21.7067,
  "low": 21.208,
  "close": 21.6807,
  "volume": 72771405.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 94,
  "time": 1494374400.0,
  "value": 72771405.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 95,
  "time": 1494460800.0,
  "open": 21.7533,
  "high": 21.7533,
  "low": 21.23,
  "close": 21.5327,
  "volume": 60381360.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 95,
  "time": 1494460800.0,
  "value": 60381360.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 96,
  "time": 1494547200.0,
  "open": 21.54,
  "high": 21.8,
  "low": 21.4353,
  "close": 21.6653,
  "volume": 52982295.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 96,
  "time": 1494547200.0,
  "value": 52982295.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 97,
  "time": 1494806400.0,
  "open": 21.2587,
  "high": 21.3467,
  "low": 20.8353,
  "close": 21.06,
  "volume": 98139675.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 97,
  "time": 1494806400.0,
  "value": 98139675.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 98,
  "time": 1494892800.0,
  "open": 21.1133,
  "high": 21.3373,
  "low": 21.0027,
  "close": 21.0333,
  "volume": 53030295.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 98,
  "time": 1494892800.0,
  "value": 53030295.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 99,
  "time": 1494979200.0,
  "open": 21.0267,
  "high": 21.0267,
  "low": 20.352,
  "close": 20.4133,
  "volume": 84943980.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 99,
  "time": 1494979200.0,
  "value": 84943980.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 100,
  "time": 1495065600.0,
  "open": 20.396,
  "high": 20.9293,
  "low": 20.1667,
  "close": 20.8233,
  "volume": 73016490.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 100,
  "time": 1495065600.0,
  "value": 73016490.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 101,
  "time": 1495152000.0,
  "open": 20.8733,
  "high": 21.1167,
  "low": 20.6587,
  "close": 20.6913,
  "volume": 59414115.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 101,
  "time": 1495152000.0,
  "value": 59414115.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 102,
  "time": 1495411200.0,
  "open": 20.71,
  "high": 20.958,
  "low": 20.4533,
  "close": 20.6473,
  "volume": 53613555.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 102,
  "time": 1495411200.0,
  "value": 53613555.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 103,
  "time": 1495497600.0,
  "open": 20.732,
  "high": 20.732,
  "low": 20.232,
  "close": 20.262,
  "volume": 53430645.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 103,
  "time": 1495497600.0,
  "value": 53430645.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 104,
  "time": 1501632000.0,
  "open": 21.4,
  "high": 23.736,
  "low": 20.748,
  "close": 23.334,
  "volume": 158508465.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 104,
  "time": 1501632000.0,
  "value": 158508465.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 105,
  "time": 1501718400.0,
  "open": 23.114,
  "high": 23.34,
  "low": 22.8667,
  "close": 23.18,
  "volume": 169206135.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 105,
  "time": 1501718400.0,
  "value": 169206135.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 106,
  "time": 1501804800.0,
  "open": 23.1873,
  "high": 23.84,
  "low": 22.8867,
  "close": 23.8187,
  "volume": 118611315.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 106,
  "time": 1501804800.0,
  "value": 118611315.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 107,
  "time": 1502064000.0,
  "open": 24.0,
  "high": 24.0,
  "low": 23.5167,
  "close": 23.6667,
  "volume": 76922280.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 107,
  "time": 1502064000.0,
  "value": 76922280.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 108,
  "time": 1502150400.0,
  "open": 23.6333,
  "high": 24.572,
  "low": 23.6207,
  "close": 24.2547,
  "volume": 92226420.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 108,
  "time": 1502150400.0,
  "value": 92226420.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 109,
  "time": 1502236800.0,
  "open": 24.208,
  "high": 24.6667,
  "low": 23.8747,
  "close": 24.2773,
  "volume": 86519625.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 109,
  "time": 1502236800.0,
  "value": 86519625.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 110,
  "time": 1502323200.0,
  "open": 24.22,
  "high": 24.444,
  "low": 23.5533,
  "close": 23.5667,
  "volume": 88535805.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 110,
  "time": 1502323200.0,
  "value": 88535805.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 111,
  "time": 1502409600.0,
  "open": 23.5447,
  "high": 24.084,
  "low": 23.3333,
  "close": 23.8667,
  "volume": 54039555.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 111,
  "time": 1502409600.0,
  "value": 54039555.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 112,
  "time": 1502668800.0,
  "open": 24.0667,
  "high": 24.5107,
  "low": 24.0667,
  "close": 24.28,
  "volume": 55720770.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 112,
  "time": 1502668800.0,
  "value": 55720770.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 113,
  "time": 1502755200.0,
  "open": 24.3433,
  "high": 24.38,
  "low": 23.958,
  "close": 24.1307,
  "volume": 36768285.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 113,
  "time": 1502755200.0,
  "value": 36768285.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 114,
  "time": 1502841600.0,
  "open": 24.1533,
  "high": 24.4333,
  "low": 24.068,
  "close": 24.2067,
  "volume": 39519210.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 114,
  "time": 1502841600.0,
  "value": 39519210.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 115,
  "time": 1502928000.0,
  "open": 24.258,
  "high": 24.26,
  "low": 23.4267,
  "close": 23.4333,
  "volume": 59729325.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 115,
  "time": 1502928000.0,
  "value": 59729325.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 116,
  "time": 1503014400.0,
  "open": 23.3333,
  "high": 23.6167,
  "low": 23.0007,
  "close": 23.0707,
  "volume": 64878945.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 116,
  "time": 1503014400.0,
  "value": 64878945.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 117,
  "time": 1503273600.0,
  "open": 23.144,
  "high": 23.1867,
  "low": 22.1233,
  "close": 22.4547,
  "volume": 80873040.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 117,
  "time": 1503273600.0,
  "value": 80873040.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 118,
  "time": 1503360000.0,
  "open": 22.7793,
  "high": 22.816,
  "low": 22.4913,
  "close": 22.7707,
  "volume": 53835240.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 118,
  "time": 1503360000.0,
  "value": 53835240.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 119,
  "time": 1503446400.0,
  "open": 22.72,
  "high": 23.566,
  "low": 22.5413,
  "close": 23.46,
  "volume": 59650080.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 119,
  "time": 1503446400.0,
  "value": 59650080.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 120,
  "time": 1503532800.0,
  "open": 23.5327,
  "high": 23.7773,
  "low": 23.316,
  "close": 23.5467,
  "volume": 53365110.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 120,
  "time": 1503532800.0,
  "value": 53365110.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 121,
  "time": 1503619200.0,
  "open": 23.6,
  "high": 23.7127,
  "low": 23.1533,
  "close": 23.1813,
  "volume": 42063270.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 121,
  "time": 1503619200.0,
  "value": 42063270.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 122,
  "time": 1503878400.0,
  "open": 23.1707,
  "high": 23.2267,
  "low": 22.648,
  "close": 22.8873,
  "volume": 43703055.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 122,
  "time": 1503878400.0,
  "value": 43703055.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 123,
  "time": 1503964800.0,
  "open": 22.7333,
  "high": 23.27,
  "low": 22.5627,
  "close": 23.1987,
  "volume": 47693040.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 123,
  "time": 1503964800.0,
  "value": 47693040.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 124,
  "time": 1504051200.0,
  "open": 23.2707,
  "high": 23.5653,
  "low": 23.1093,
  "close": 23.5653,
  "volume": 39211260.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 124,
  "time": 1504051200.0,
  "value": 39211260.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 125,
  "time": 1504137600.0,
  "open": 23.5733,
  "high": 23.896,
  "low": 23.5213,
  "close": 23.68,
  "volume": 47533125.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 125,
  "time": 1504137600.0,
  "value": 47533125.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 126,
  "time": 1504224000.0,
  "open": 23.7333,
  "high": 23.8393,
  "low": 23.5793,
  "close": 23.6673,
  "volume": 36370140.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 126,
  "time": 1504224000.0,
  "value": 36370140.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 127,
  "time": 1504569600.0,
  "open": 23.6433,
  "high": 23.6993,
  "low": 23.0593,
  "close": 23.3267,
  "volume": 46009875.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 127,
  "time": 1504569600.0,
  "value": 46009875.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 128,
  "time": 1504656000.0,
  "open": 23.3707,
  "high": 23.5,
  "low": 22.7707,
  "close": 22.9773,
  "volume": 49117995.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 128,
  "time": 1504656000.0,
  "value": 49117995.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 129,
  "time": 1504742400.0,
  "open": 23.0727,
  "high": 23.4987,
  "low": 22.8967,
  "close": 23.3787,
  "volume": 50711130.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 129,
  "time": 1504742400.0,
  "value": 50711130.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 130,
  "time": 1504828800.0,
  "open": 23.3093,
  "high": 23.3187,
  "low": 22.82,
  "close": 22.8953,
  "volume": 38831370.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 130,
  "time": 1504828800.0,
  "value": 38831370.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 131,
  "time": 1505088000.0,
  "open": 23.2,
  "high": 24.266,
  "low": 23.2,
  "close": 24.234,
  "volume": 93792450.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 131,
  "time": 1505088000.0,
  "value": 93792450.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 132,
  "time": 1505174400.0,
  "open": 24.2733,
  "high": 24.584,
  "low": 24.0267,
  "close": 24.1667,
  "volume": 71484885.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 132,
  "time": 1505174400.0,
  "value": 71484885.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 133,
  "time": 1505260800.0,
  "open": 24.19,
  "high": 24.538,
  "low": 23.9727,
  "close": 24.4,
  "volume": 51254190.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 133,
  "time": 1505260800.0,
  "value": 51254190.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 134,
  "time": 1505347200.0,
  "open": 24.3333,
  "high": 25.1973,
  "low": 24.1753,
  "close": 24.8987,
  "volume": 88268760.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 134,
  "time": 1505347200.0,
  "value": 88268760.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 135,
  "time": 1505433600.0,
  "open": 24.9793,
  "high": 25.36,
  "low": 24.8467,
  "close": 25.3553,
  "volume": 65391495.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 135,
  "time": 1505433600.0,
  "value": 65391495.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 136,
  "time": 1505692800.0,
  "open": 25.4,
  "high": 25.974,
  "low": 25.1787,
  "close": 25.6533,
  "volume": 88693770.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 136,
  "time": 1505692800.0,
  "value": 88693770.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 137,
  "time": 1505779200.0,
  "open": 25.48,
  "high": 25.4927,
  "low": 24.9047,
  "close": 24.9547,
  "volume": 77656125.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 137,
  "time": 1505779200.0,
  "value": 77656125.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 138,
  "time": 1505865600.0,
  "open": 25.0133,
  "high": 25.2167,
  "low": 24.738,
  "close": 24.944,
  "volume": 60187995.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 138,
  "time": 1505865600.0,
  "value": 60187995.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 139,
  "time": 1505952000.0,
  "open": 24.928,
  "high": 25.122,
  "low": 24.3007,
  "close": 24.432,
  "volume": 58301040.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 139,
  "time": 1505952000.0,
  "value": 58301040.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 140,
  "time": 1506038400.0,
  "open": 24.4,
  "high": 24.66,
  "low": 23.37,
  "close": 23.38,
  "volume": 100120800.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 140,
  "time": 1506038400.0,
  "value": 100120800.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 141,
  "time": 1506297600.0,
  "open": 23.378,
  "high": 23.8313,
  "low": 22.8587,
  "close": 23.002,
  "volume": 95209215.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 141,
  "time": 1506297600.0,
  "value": 95209215.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 142,
  "time": 1506384000.0,
  "open": 23.08,
  "high": 23.416,
  "low": 22.7267,
  "close": 23.0267,
  "volume": 89596305.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 142,
  "time": 1506384000.0,
  "value": 89596305.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 143,
  "time": 1506470400.0,
  "open": 23.2633,
  "high": 23.4327,
  "low": 22.7,
  "close": 22.74,
  "volume": 73275165.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 143,
  "time": 1506470400.0,
  "value": 73275165.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 144,
  "time": 1506556800.0,
  "open": 22.7333,
  "high": 22.85,
  "low": 22.36,
  "close": 22.7133,
  "volume": 63105405.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 144,
  "time": 1506556800.0,
  "value": 63105405.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 145,
  "time": 1506643200.0,
  "open": 22.768,
  "high": 22.9787,
  "low": 22.5733,
  "close": 22.72,
  "volume": 62996130.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 145,
  "time": 1506643200.0,
  "value": 62996130.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 146,
  "time": 1506902400.0,
  "open": 22.872,
  "high": 23.2067,
  "low": 22.34,
  "close": 22.4,
  "volume": 63673905.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 146,
  "time": 1506902400.0,
  "value": 63673905.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 147,
  "time": 1506988800.0,
  "open": 22.4667,
  "high": 23.476,
  "low": 22.0853,
  "close": 23.422,
  "volume": 127915005.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 147,
  "time": 1506988800.0,
  "value": 127915005.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 148,
  "time": 1507075200.0,
  "open": 23.4,
  "high": 23.908,
  "low": 23.282,
  "close": 23.7253,
  "volume": 102388050.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 148,
  "time": 1507075200.0,
  "value": 102388050.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 149,
  "time": 1507161600.0,
  "open": 23.6327,
  "high": 23.8293,
  "low": 23.4233,
  "close": 23.6967,
  "volume": 49240515.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 149,
  "time": 1507161600.0,
  "value": 49240515.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 150,
  "time": 1507248000.0,
  "open": 23.6973,
  "high": 24.0067,
  "low": 23.4833,
  "close": 23.5867,
  "volume": 52458270.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 150,
  "time": 1507248000.0,
  "value": 52458270.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 151,
  "time": 1507507200.0,
  "open": 23.5587,
  "high": 23.6,
  "low": 22.8407,
  "close": 23.0467,
  "volume": 91929060.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 151,
  "time": 1507507200.0,
  "value": 91929060.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 152,
  "time": 1507593600.0,
  "open": 23.086,
  "high": 23.744,
  "low": 23.0353,
  "close": 23.7167,
  "volume": 85714425.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 152,
  "time": 1507593600.0,
  "value": 85714425.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 153,
  "time": 1507680000.0,
  "open": 23.7,
  "high": 23.84,
  "low": 23.41,
  "close": 23.6333,
  "volume": 54369930.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 153,
  "time": 1507680000.0,
  "value": 54369930.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 154,
  "time": 1507766400.0,
  "open": 23.5793,
  "high": 23.9853,
  "low": 23.4667,
  "close": 23.6633,
  "volume": 49478250.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 154,
  "time": 1507766400.0,
  "value": 49478250.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 155,
  "time": 1507852800.0,
  "open": 23.7033,
  "high": 23.8993,
  "low": 23.5787,
  "close": 23.7467,
  "volume": 42626325.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 155,
  "time": 1507852800.0,
  "value": 42626325.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 156,
  "time": 1508112000.0,
  "open": 23.5833,
  "high": 23.6667,
  "low": 23.144,
  "close": 23.3833,
  "volume": 63696315.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 156,
  "time": 1508112000.0,
  "value": 63696315.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 157,
  "time": 1508198400.0,
  "open": 23.4167,
  "high": 23.748,
  "low": 23.3333,
  "close": 23.69,
  "volume": 39478785.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 157,
  "time": 1508198400.0,
  "value": 39478785.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 158,
  "time": 1508284800.0,
  "open": 23.6267,
  "high": 24.2,
  "low": 23.6087,
  "close": 23.9767,
  "volume": 58906215.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 158,
  "time": 1508284800.0,
  "value": 58906215.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 159,
  "time": 1508371200.0,
  "open": 23.8,
  "high": 23.8533,
  "low": 23.2133,
  "close": 23.416,
  "volume": 60596670.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 159,
  "time": 1508371200.0,
  "value": 60596670.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 160,
  "time": 1508457600.0,
  "open": 23.45,
  "high": 23.6367,
  "low": 22.956,
  "close": 22.9933,
  "volume": 58987380.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 160,
  "time": 1508457600.0,
  "value": 58987380.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 161,
  "time": 1508716800.0,
  "open": 23.3133,
  "high": 23.4833,
  "low": 22.4167,
  "close": 22.534,
  "volume": 69079140.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 161,
  "time": 1508716800.0,
  "value": 69079140.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 162,
  "time": 1508803200.0,
  "open": 22.4667,
  "high": 22.8533,
  "low": 22.4107,
  "close": 22.5,
  "volume": 54037110.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 162,
  "time": 1508803200.0,
  "value": 54037110.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 163,
  "time": 1508889600.0,
  "open": 22.5013,
  "high": 22.53,
  "low": 21.5707,
  "close": 21.75,
  "volume": 84060840.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 163,
  "time": 1508889600.0,
  "value": 84060840.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 164,
  "time": 1508976000.0,
  "open": 22.1,
  "high": 22.1,
  "low": 21.5467,
  "close": 21.886,
  "volume": 59895495.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 164,
  "time": 1508976000.0,
  "value": 59895495.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 165,
  "time": 1509062400.0,
  "open": 21.6667,
  "high": 21.8893,
  "low": 21.1107,
  "close": 21.3667,
  "volume": 82456560.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 165,
  "time": 1509062400.0,
  "value": 82456560.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 166,
  "time": 1509321600.0,
  "open": 21.4073,
  "high": 21.5853,
  "low": 21.15,
  "close": 21.2733,
  "volume": 50183595.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 166,
  "time": 1509321600.0,
  "value": 50183595.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 167,
  "time": 1509408000.0,
  "open": 21.3667,
  "high": 22.2,
  "low": 21.3453,
  "close": 22.2,
  "volume": 67143015.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 167,
  "time": 1509408000.0,
  "value": 67143015.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 168,
  "time": 1509494400.0,
  "open": 22.2633,
  "high": 22.2667,
  "low": 20.14,
  "close": 20.3267,
  "volume": 98873415.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 168,
  "time": 1509494400.0,
  "value": 98873415.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 169,
  "time": 1509580800.0,
  "open": 20.3,
  "high": 21.4053,
  "low": 19.5087,
  "close": 19.9627,
  "volume": 239871705.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 169,
  "time": 1509580800.0,
  "value": 239871705.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 170,
  "time": 1509667200.0,
  "open": 19.8573,
  "high": 20.434,
  "low": 19.6753,
  "close": 20.4133,
  "volume": 106874280.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 170,
  "time": 1509667200.0,
  "value": 106874280.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.setMarkers([{"time": 1491264000.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}, {"time": 1491523200.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}, {"time": 1492041600.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}, {"time": 1493942400.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}, {"time": 1509667200.0, "position": "belowBar", "color": "#2196F3", "shape": "arrowUp", "text": "The price crossed $20!"}])
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 171,
  "time": 1509926400.0,
  "open": 20.4533,
  "high": 20.626,
  "low": 19.934,
  "close": 20.1333,
  "volume": 75212505.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 171,
  "time": 1509926400.0,
  "value": 75212505.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 172,
  "time": 1510012800.0,
  "open": 20.1667,
  "high": 20.4333,
  "low": 19.634,
  "close": 20.378,
  "volume": 64488030.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 172,
  "time": 1510012800.0,
  "value": 64488030.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 173,
  "time": 1510099200.0,
  "open": 20.334,
  "high": 20.4593,
  "low": 20.0867,
  "close": 20.31,
  "volume": 58790550.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 173,
  "time": 1510099200.0,
  "value": 58790550.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 174,
  "time": 1510185600.0,
  "open": 20.2873,
  "high": 20.326,
  "low": 19.7533,
  "close": 20.14,
  "volume": 64908075.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 174,
  "time": 1510185600.0,
  "value": 64908075.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 175,
  "time": 1510272000.0,
  "open": 20.1227,
  "high": 20.5573,
  "low": 20.1227,
  "close": 20.1867,
  "volume": 55910415.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 175,
  "time": 1510272000.0,
  "value": 55910415.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 176,
  "time": 1510531200.0,
  "open": 20.2667,
  "high": 21.12,
  "low": 19.9067,
  "close": 21.0533,
  "volume": 92643630.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 176,
  "time": 1510531200.0,
  "value": 92643630.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 177,
  "time": 1510617600.0,
  "open": 21.08,
  "high": 21.0933,
  "low": 20.46,
  "close": 20.5933,
  "volume": 69989505.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 177,
  "time": 1510617600.0,
  "value": 69989505.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 178,
  "time": 1510704000.0,
  "open": 20.548,
  "high": 20.8327,
  "low": 20.1,
  "close": 20.78,
  "volume": 74143695.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 178,
  "time": 1510704000.0,
  "value": 74143695.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 179,
  "time": 1510790400.0,
  "open": 20.8833,
  "high": 21.2093,
  "low": 20.7533,
  "close": 20.8373,
  "volume": 70739175.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 179,
  "time": 1510790400.0,
  "value": 70739175.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 180,
  "time": 1510876800.0,
  "open": 21.1,
  "high": 21.8333,
  "low": 20.8767,
  "close": 21.0167,
  "volume": 170145555.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 180,
  "time": 1510876800.0,
  "value": 170145555.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 181,
  "time": 1511136000.0,
  "open": 21.0333,
  "high": 21.0333,
  "low": 20.3167,
  "close": 20.5567,
  "volume": 103487040.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 181,
  "time": 1511136000.0,
  "value": 103487040.0,
  "color": "rgba(200,127,130,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 182,
  "time": 1511222400.0,
  "open": 20.6133,
  "high": 21.2153,
  "low": 20.534,
  "close": 21.1733,
  "volume": 91762275.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 182,
  "time": 1511222400.0,
  "value": 91762275.0,
  "color": "rgba(83,141,131,0.8)"
})
/*==========*/
window.dloqqrvj.series.update({
  "Unnamed: 0": 183,
  "time": 1511308800.0,
  "open": 21.2067,
  "high": 21.266,
  "low": 20.7893,
  "close": 20.812,
  "volume": 62022240.0
})
/*==========*/
window.dloqqrvj.volumeSeries.update({
  "Unnamed: 0": 183,
  "time": 1511308800.0,
  "value": 62022240.0,
  "color": "rgba(200,127,130,0.8)"
})