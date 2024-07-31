
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
    token: '7079c7fb3183434abb6ede671dfbf6b5',
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

window.callbackFunction = pywebview.api.callback
window.ltoukohz = new Lib.Handler("window.ltoukohz", 1.0, 1.0, "left", true)
window.ltoukohz.createToolBox()

        window.ltoukohz.legend.div.style.display = 'flex'
        window.ltoukohz.legend.ohlcEnabled = true
        window.ltoukohz.legend.percentEnabled = true
        window.ltoukohz.legend.linesEnabled = true
        window.ltoukohz.legend.colorBasedOnCandle = false
        window.ltoukohz.legend.div.style.color = 'rgb(191, 195, 203)'
        window.ltoukohz.legend.color = 'rgb(191, 195, 203)'
        window.ltoukohz.legend.div.style.fontSize = '11px'
        window.ltoukohz.legend.div.style.fontFamily = 'Monaco'
        window.ltoukohz.legend.text.innerText = ''
        

            Lib.Handler.makeSpinner(window.ltoukohz)
            window.ltoukohz.search = Lib.Handler.makeSearchBox(window.ltoukohz)
            
window.tfarfbty = window.ltoukohz.createTopBar()
window.shrnknst = window.tfarfbty.makeTextBoxWidget("TSLA", "left", )
window.qwwjrjyw = window.tfarfbty.makeSwitcher(['1min', '5min', '30min'], "5min", "window.qwwjrjyw", "left")
window.ltoukohz.series.setData([
  {
    "Unnamed: 0.1": 0,
    "Unnamed: 0": 0,
    "time": 1683792000,
    "open": 169.06,
    "high": 169.69,
    "low": 168.45,
    "close": 169.26,
    "volume": 12398.0
  },
  {
    "Unnamed: 0.1": 1,
    "Unnamed: 0": 1,
    "time": 1683792300,
    "open": 169.2,
    "high": 169.29,
    "low": 169.14,
    "close": 169.22,
    "volume": 4999.0
  },
  {
    "Unnamed: 0.1": 2,
    "Unnamed: 0": 2,
    "time": 1683792600,
    "open": 169.26,
    "high": 169.39,
    "low": 169.26,
    "close": 169.36,
    "volume": 2460.0
  },
  {
    "Unnamed: 0.1": 3,
    "Unnamed: 0": 3,
    "time": 1683792900,
    "open": 169.35,
    "high": 169.56,
    "low": 169.35,
    "close": 169.5,
    "volume": 3048.0
  },
  {
    "Unnamed: 0.1": 4,
    "Unnamed: 0": 4,
    "time": 1683793200,
    "open": 169.54,
    "high": 169.6,
    "low": 169.5,
    "close": 169.58,
    "volume": 4469.0
  },
  {
    "Unnamed: 0.1": 5,
    "Unnamed: 0": 5,
    "time": 1683793500,
    "open": 169.58,
    "high": 169.69,
    "low": 169.48,
    "close": 169.5,
    "volume": 7908.0
  },
  {
    "Unnamed: 0.1": 6,
    "Unnamed: 0": 6,
    "time": 1683793800,
    "open": 169.5,
    "high": 169.7,
    "low": 169.5,
    "close": 169.7,
    "volume": 2864.0
  },
  {
    "Unnamed: 0.1": 7,
    "Unnamed: 0": 7,
    "time": 1683794100,
    "open": 169.72,
    "high": 169.72,
    "low": 169.5,
    "close": 169.54,
    "volume": 2072.0
  },
  {
    "Unnamed: 0.1": 8,
    "Unnamed: 0": 8,
    "time": 1683794400,
    "open": 169.53,
    "high": 169.61,
    "low": 169.5,
    "close": 169.5,
    "volume": 745.0
  },
  {
    "Unnamed: 0.1": 9,
    "Unnamed: 0": 9,
    "time": 1683794700,
    "open": 169.46,
    "high": 169.54,
    "low": 169.46,
    "close": 169.54,
    "volume": 715.0
  },
  {
    "Unnamed: 0.1": 10,
    "Unnamed: 0": 10,
    "time": 1683795000,
    "open": 169.54,
    "high": 169.56,
    "low": 169.54,
    "close": 169.56,
    "volume": 229.0
  },
  {
    "Unnamed: 0.1": 11,
    "Unnamed: 0": 11,
    "time": 1683795300,
    "open": 169.64,
    "high": 169.64,
    "low": 169.56,
    "close": 169.56,
    "volume": 1202.0
  },
  {
    "Unnamed: 0.1": 12,
    "Unnamed: 0": 12,
    "time": 1683795600,
    "open": 169.54,
    "high": 169.73,
    "low": 169.54,
    "close": 169.73,
    "volume": 3250.0
  },
  {
    "Unnamed: 0.1": 13,
    "Unnamed: 0": 13,
    "time": 1683795900,
    "open": 169.73,
    "high": 169.73,
    "low": 169.7,
    "close": 169.7,
    "volume": 835.0
  },
  {
    "Unnamed: 0.1": 14,
    "Unnamed: 0": 14,
    "time": 1683796200,
    "open": 169.62,
    "high": 169.69,
    "low": 169.62,
    "close": 169.69,
    "volume": 1041.0
  },
  {
    "Unnamed: 0.1": 15,
    "Unnamed: 0": 15,
    "time": 1683796500,
    "open": 169.67,
    "high": 169.69,
    "low": 169.64,
    "close": 169.64,
    "volume": 492.0
  },
  {
    "Unnamed: 0.1": 16,
    "Unnamed: 0": 16,
    "time": 1683796800,
    "open": 169.62,
    "high": 169.95,
    "low": 169.6,
    "close": 169.89,
    "volume": 5289.0
  },
  {
    "Unnamed: 0.1": 17,
    "Unnamed: 0": 17,
    "time": 1683797100,
    "open": 169.89,
    "high": 169.93,
    "low": 169.81,
    "close": 169.91,
    "volume": 3344.0
  },
  {
    "Unnamed: 0.1": 18,
    "Unnamed: 0": 18,
    "time": 1683797400,
    "open": 169.9,
    "high": 169.97,
    "low": 169.87,
    "close": 169.93,
    "volume": 3447.0
  },
  {
    "Unnamed: 0.1": 19,
    "Unnamed: 0": 19,
    "time": 1683797700,
    "open": 169.93,
    "high": 170.13,
    "low": 169.92,
    "close": 170.0,
    "volume": 5992.0
  },
  {
    "Unnamed: 0.1": 20,
    "Unnamed: 0": 20,
    "time": 1683798000,
    "open": 169.96,
    "high": 169.96,
    "low": 169.9,
    "close": 169.9,
    "volume": 1306.0
  },
  {
    "Unnamed: 0.1": 21,
    "Unnamed: 0": 21,
    "time": 1683798300,
    "open": 169.88,
    "high": 169.9,
    "low": 169.88,
    "close": 169.9,
    "volume": 643.0
  },
  {
    "Unnamed: 0.1": 22,
    "Unnamed: 0": 22,
    "time": 1683798600,
    "open": 169.85,
    "high": 169.86,
    "low": 169.81,
    "close": 169.85,
    "volume": 2865.0
  },
  {
    "Unnamed: 0.1": 23,
    "Unnamed: 0": 23,
    "time": 1683798900,
    "open": 169.85,
    "high": 169.85,
    "low": 169.72,
    "close": 169.72,
    "volume": 2125.0
  },
  {
    "Unnamed: 0.1": 24,
    "Unnamed: 0": 24,
    "time": 1683799200,
    "open": 169.73,
    "high": 169.9,
    "low": 169.73,
    "close": 169.88,
    "volume": 2156.0
  },
  {
    "Unnamed: 0.1": 25,
    "Unnamed: 0": 25,
    "time": 1683799500,
    "open": 169.9,
    "high": 169.9,
    "low": 169.89,
    "close": 169.89,
    "volume": 300.0
  },
  {
    "Unnamed: 0.1": 26,
    "Unnamed: 0": 26,
    "time": 1683799800,
    "open": 169.73,
    "high": 169.73,
    "low": 169.56,
    "close": 169.62,
    "volume": 3253.0
  },
  {
    "Unnamed: 0.1": 27,
    "Unnamed: 0": 27,
    "time": 1683800100,
    "open": 169.75,
    "high": 169.75,
    "low": 169.58,
    "close": 169.58,
    "volume": 1464.0
  },
  {
    "Unnamed: 0.1": 28,
    "Unnamed: 0": 28,
    "time": 1683800400,
    "open": 169.66,
    "high": 169.66,
    "low": 169.66,
    "close": 169.66,
    "volume": 200.0
  },
  {
    "Unnamed: 0.1": 29,
    "Unnamed: 0": 29,
    "time": 1683800700,
    "open": 169.72,
    "high": 169.82,
    "low": 169.72,
    "close": 169.82,
    "volume": 1000.0
  },
  {
    "Unnamed: 0.1": 30,
    "Unnamed: 0": 30,
    "time": 1683801000,
    "open": 169.75,
    "high": 169.75,
    "low": 169.71,
    "close": 169.71,
    "volume": 576.0
  },
  {
    "Unnamed: 0.1": 31,
    "Unnamed: 0": 31,
    "time": 1683801300,
    "open": 169.68,
    "high": 169.77,
    "low": 169.56,
    "close": 169.76,
    "volume": 2330.0
  },
  {
    "Unnamed: 0.1": 32,
    "Unnamed: 0": 32,
    "time": 1683801600,
    "open": 169.7,
    "high": 169.7,
    "low": 169.65,
    "close": 169.65,
    "volume": 693.0
  },
  {
    "Unnamed: 0.1": 33,
    "Unnamed: 0": 33,
    "time": 1683801900,
    "open": 169.6,
    "high": 169.66,
    "low": 169.6,
    "close": 169.65,
    "volume": 713.0
  },
  {
    "Unnamed: 0.1": 34,
    "Unnamed: 0": 34,
    "time": 1683802200,
    "open": 169.58,
    "high": 169.58,
    "low": 169.58,
    "close": 169.58,
    "volume": 100.0
  },
  {
    "Unnamed: 0.1": 35,
    "Unnamed: 0": 35,
    "time": 1683802500,
    "open": 169.6,
    "high": 169.6,
    "low": 169.45,
    "close": 169.48,
    "volume": 4163.0
  },
  {
    "Unnamed: 0.1": 36,
    "Unnamed: 0": 36,
    "time": 1683802800,
    "open": 169.45,
    "high": 169.5,
    "low": 168.89,
    "close": 169.05,
    "volume": 29864.0
  },
  {
    "Unnamed: 0.1": 37,
    "Unnamed: 0": 37,
    "time": 1683803100,
    "open": 169.05,
    "high": 169.1,
    "low": 168.73,
    "close": 168.8,
    "volume": 13183.0
  },
  {
    "Unnamed: 0.1": 38,
    "Unnamed: 0": 38,
    "time": 1683803400,
    "open": 168.75,
    "high": 168.88,
    "low": 168.65,
    "close": 168.87,
    "volume": 17187.0
  },
  {
    "Unnamed: 0.1": 39,
    "Unnamed: 0": 39,
    "time": 1683803700,
    "open": 168.9,
    "high": 169.14,
    "low": 168.88,
    "close": 168.95,
    "volume": 11387.0
  },
  {
    "Unnamed: 0.1": 40,
    "Unnamed: 0": 40,
    "time": 1683804000,
    "open": 168.94,
    "high": 168.95,
    "low": 168.7,
    "close": 168.79,
    "volume": 12165.0
  },
  {
    "Unnamed: 0.1": 41,
    "Unnamed: 0": 41,
    "time": 1683804300,
    "open": 168.77,
    "high": 169.19,
    "low": 168.77,
    "close": 169.19,
    "volume": 11409.0
  },
  {
    "Unnamed: 0.1": 42,
    "Unnamed: 0": 42,
    "time": 1683804600,
    "open": 169.18,
    "high": 169.22,
    "low": 169.02,
    "close": 169.02,
    "volume": 4265.0
  },
  {
    "Unnamed: 0.1": 43,
    "Unnamed: 0": 43,
    "time": 1683804900,
    "open": 169.01,
    "high": 169.1,
    "low": 169.0,
    "close": 169.03,
    "volume": 2826.0
  },
  {
    "Unnamed: 0.1": 44,
    "Unnamed: 0": 44,
    "time": 1683805200,
    "open": 169.06,
    "high": 169.1,
    "low": 168.89,
    "close": 168.89,
    "volume": 19258.0
  },
  {
    "Unnamed: 0.1": 45,
    "Unnamed: 0": 45,
    "time": 1683805500,
    "open": 168.88,
    "high": 168.93,
    "low": 168.75,
    "close": 168.93,
    "volume": 6722.0
  },
  {
    "Unnamed: 0.1": 46,
    "Unnamed: 0": 46,
    "time": 1683805800,
    "open": 168.93,
    "high": 168.95,
    "low": 168.87,
    "close": 168.95,
    "volume": 1517.0
  },
  {
    "Unnamed: 0.1": 47,
    "Unnamed: 0": 47,
    "time": 1683806100,
    "open": 168.9,
    "high": 168.9,
    "low": 168.8,
    "close": 168.8,
    "volume": 4212.0
  },
  {
    "Unnamed: 0.1": 48,
    "Unnamed: 0": 48,
    "time": 1683806400,
    "open": 169.39,
    "high": 169.65,
    "low": 167.59,
    "close": 168.8,
    "volume": 124679.0
  },
  {
    "Unnamed: 0.1": 49,
    "Unnamed: 0": 49,
    "time": 1683806700,
    "open": 168.8,
    "high": 169.08,
    "low": 168.79,
    "close": 169.04,
    "volume": 18155.0
  },
  {
    "Unnamed: 0.1": 50,
    "Unnamed: 0": 50,
    "time": 1683807000,
    "open": 169.05,
    "high": 169.17,
    "low": 169.0,
    "close": 169.14,
    "volume": 21809.0
  },
  {
    "Unnamed: 0.1": 51,
    "Unnamed: 0": 51,
    "time": 1683807300,
    "open": 169.14,
    "high": 169.4,
    "low": 169.05,
    "close": 169.19,
    "volume": 27310.0
  },
  {
    "Unnamed: 0.1": 52,
    "Unnamed: 0": 52,
    "time": 1683807600,
    "open": 169.16,
    "high": 169.17,
    "low": 169.01,
    "close": 169.05,
    "volume": 18917.0
  },
  {
    "Unnamed: 0.1": 53,
    "Unnamed: 0": 53,
    "time": 1683807900,
    "open": 169.06,
    "high": 169.2,
    "low": 169.06,
    "close": 169.2,
    "volume": 30471.0
  },
  {
    "Unnamed: 0.1": 54,
    "Unnamed: 0": 54,
    "time": 1683808200,
    "open": 169.2,
    "high": 169.5,
    "low": 169.02,
    "close": 169.25,
    "volume": 87415.0
  },
  {
    "Unnamed: 0.1": 55,
    "Unnamed: 0": 55,
    "time": 1683808500,
    "open": 169.15,
    "high": 169.48,
    "low": 168.83,
    "close": 169.45,
    "volume": 66402.0
  },
  {
    "Unnamed: 0.1": 56,
    "Unnamed: 0": 56,
    "time": 1683808800,
    "open": 169.4,
    "high": 169.48,
    "low": 169.26,
    "close": 169.43,
    "volume": 29101.0
  },
  {
    "Unnamed: 0.1": 57,
    "Unnamed: 0": 57,
    "time": 1683809100,
    "open": 169.36,
    "high": 169.59,
    "low": 169.32,
    "close": 169.46,
    "volume": 33949.0
  },
  {
    "Unnamed: 0.1": 58,
    "Unnamed: 0": 58,
    "time": 1683809400,
    "open": 169.41,
    "high": 169.66,
    "low": 169.41,
    "close": 169.66,
    "volume": 32036.0
  },
  {
    "Unnamed: 0.1": 59,
    "Unnamed: 0": 59,
    "time": 1683809700,
    "open": 169.61,
    "high": 169.66,
    "low": 169.21,
    "close": 169.41,
    "volume": 47495.0
  },
  {
    "Unnamed: 0.1": 60,
    "Unnamed: 0": 60,
    "time": 1683810000,
    "open": 169.41,
    "high": 169.45,
    "low": 168.8,
    "close": 169.05,
    "volume": 56564.0
  },
  {
    "Unnamed: 0.1": 61,
    "Unnamed: 0": 61,
    "time": 1683810300,
    "open": 169.05,
    "high": 169.05,
    "low": 168.82,
    "close": 168.86,
    "volume": 33184.0
  },
  {
    "Unnamed: 0.1": 62,
    "Unnamed: 0": 62,
    "time": 1683810600,
    "open": 168.86,
    "high": 169.1,
    "low": 168.86,
    "close": 169.1,
    "volume": 41535.0
  },
  {
    "Unnamed: 0.1": 63,
    "Unnamed: 0": 63,
    "time": 1683810900,
    "open": 169.08,
    "high": 169.14,
    "low": 169.0,
    "close": 169.05,
    "volume": 10504.0
  },
  {
    "Unnamed: 0.1": 64,
    "Unnamed: 0": 64,
    "time": 1683811200,
    "open": 169.08,
    "high": 169.09,
    "low": 168.82,
    "close": 168.84,
    "volume": 34073.0
  },
  {
    "Unnamed: 0.1": 65,
    "Unnamed: 0": 65,
    "time": 1683811500,
    "open": 168.84,
    "high": 168.85,
    "low": 168.68,
    "close": 168.7,
    "volume": 44916.0
  },
  {
    "Unnamed: 0.1": 66,
    "Unnamed: 0": 66,
    "time": 1683811800,
    "open": 168.7,
    "high": 168.78,
    "low": 166.79,
    "close": 167.34,
    "volume": 2417972.0
  },
  {
    "Unnamed: 0.1": 67,
    "Unnamed: 0": 67,
    "time": 1683812100,
    "open": 167.34,
    "high": 168.54,
    "low": 166.91,
    "close": 168.36,
    "volume": 2412109.0
  },
  {
    "Unnamed: 0.1": 68,
    "Unnamed: 0": 68,
    "time": 1683812400,
    "open": 168.37,
    "high": 168.46,
    "low": 167.73,
    "close": 168.22,
    "volume": 1651438.0
  },
  {
    "Unnamed: 0.1": 69,
    "Unnamed: 0": 69,
    "time": 1683812700,
    "open": 168.23,
    "high": 168.87,
    "low": 167.43,
    "close": 167.8,
    "volume": 2055091.0
  },
  {
    "Unnamed: 0.1": 70,
    "Unnamed: 0": 70,
    "time": 1683813000,
    "open": 167.79,
    "high": 168.29,
    "low": 167.42,
    "close": 167.78,
    "volume": 1656786.0
  },
  {
    "Unnamed: 0.1": 71,
    "Unnamed: 0": 71,
    "time": 1683813300,
    "open": 167.77,
    "high": 168.12,
    "low": 167.51,
    "close": 167.74,
    "volume": 1474799.0
  },
  {
    "Unnamed: 0.1": 72,
    "Unnamed: 0": 72,
    "time": 1683813600,
    "open": 167.77,
    "high": 168.82,
    "low": 167.74,
    "close": 168.17,
    "volume": 1828611.0
  },
  {
    "Unnamed: 0.1": 73,
    "Unnamed: 0": 73,
    "time": 1683813900,
    "open": 168.17,
    "high": 168.77,
    "low": 168.15,
    "close": 168.58,
    "volume": 1210247.0
  },
  {
    "Unnamed: 0.1": 74,
    "Unnamed: 0": 74,
    "time": 1683814200,
    "open": 168.58,
    "high": 169.32,
    "low": 168.48,
    "close": 169.18,
    "volume": 1733818.0
  },
  {
    "Unnamed: 0.1": 75,
    "Unnamed: 0": 75,
    "time": 1683814500,
    "open": 169.18,
    "high": 169.61,
    "low": 168.53,
    "close": 168.57,
    "volume": 1829549.0
  },
  {
    "Unnamed: 0.1": 76,
    "Unnamed: 0": 76,
    "time": 1683814800,
    "open": 168.56,
    "high": 168.75,
    "low": 167.97,
    "close": 168.25,
    "volume": 1563771.0
  },
  {
    "Unnamed: 0.1": 77,
    "Unnamed: 0": 77,
    "time": 1683815100,
    "open": 168.25,
    "high": 168.6,
    "low": 168.06,
    "close": 168.19,
    "volume": 1159607.0
  },
  {
    "Unnamed: 0.1": 78,
    "Unnamed: 0": 78,
    "time": 1683815400,
    "open": 168.18,
    "high": 168.21,
    "low": 167.48,
    "close": 167.6,
    "volume": 1499795.0
  },
  {
    "Unnamed: 0.1": 79,
    "Unnamed: 0": 79,
    "time": 1683815700,
    "open": 167.58,
    "high": 167.8,
    "low": 167.49,
    "close": 167.68,
    "volume": 1072593.0
  },
  {
    "Unnamed: 0.1": 80,
    "Unnamed: 0": 80,
    "time": 1683816000,
    "open": 167.68,
    "high": 168.15,
    "low": 167.44,
    "close": 167.83,
    "volume": 1472952.0
  },
  {
    "Unnamed: 0.1": 81,
    "Unnamed: 0": 81,
    "time": 1683816300,
    "open": 167.84,
    "high": 168.61,
    "low": 167.65,
    "close": 168.54,
    "volume": 1381580.0
  },
  {
    "Unnamed: 0.1": 82,
    "Unnamed: 0": 82,
    "time": 1683816600,
    "open": 168.56,
    "high": 168.8,
    "low": 168.2,
    "close": 168.71,
    "volume": 1273087.0
  },
  {
    "Unnamed: 0.1": 83,
    "Unnamed: 0": 83,
    "time": 1683816900,
    "open": 168.72,
    "high": 168.97,
    "low": 168.6,
    "close": 168.85,
    "volume": 989453.0
  },
  {
    "Unnamed: 0.1": 84,
    "Unnamed: 0": 84,
    "time": 1683817200,
    "open": 168.85,
    "high": 169.06,
    "low": 168.68,
    "close": 168.88,
    "volume": 1002333.0
  },
  {
    "Unnamed: 0.1": 85,
    "Unnamed: 0": 85,
    "time": 1683817500,
    "open": 168.87,
    "high": 169.04,
    "low": 168.53,
    "close": 168.6,
    "volume": 845510.0
  },
  {
    "Unnamed: 0.1": 86,
    "Unnamed: 0": 86,
    "time": 1683817800,
    "open": 168.6,
    "high": 168.69,
    "low": 168.12,
    "close": 168.45,
    "volume": 947543.0
  },
  {
    "Unnamed: 0.1": 87,
    "Unnamed: 0": 87,
    "time": 1683818100,
    "open": 168.45,
    "high": 168.63,
    "low": 168.22,
    "close": 168.39,
    "volume": 721736.0
  },
  {
    "Unnamed: 0.1": 88,
    "Unnamed: 0": 88,
    "time": 1683818400,
    "open": 168.38,
    "high": 168.93,
    "low": 168.36,
    "close": 168.86,
    "volume": 898776.0
  },
  {
    "Unnamed: 0.1": 89,
    "Unnamed: 0": 89,
    "time": 1683818700,
    "open": 168.87,
    "high": 169.3,
    "low": 168.63,
    "close": 169.18,
    "volume": 1016725.0
  },
  {
    "Unnamed: 0.1": 90,
    "Unnamed: 0": 90,
    "time": 1683819000,
    "open": 169.19,
    "high": 169.4,
    "low": 169.03,
    "close": 169.22,
    "volume": 860208.0
  },
  {
    "Unnamed: 0.1": 91,
    "Unnamed: 0": 91,
    "time": 1683819300,
    "open": 169.23,
    "high": 169.34,
    "low": 169.01,
    "close": 169.12,
    "volume": 659070.0
  },
  {
    "Unnamed: 0.1": 92,
    "Unnamed: 0": 92,
    "time": 1683819600,
    "open": 169.12,
    "high": 169.5,
    "low": 169.09,
    "close": 169.48,
    "volume": 857193.0
  },
  {
    "Unnamed: 0.1": 93,
    "Unnamed: 0": 93,
    "time": 1683819900,
    "open": 169.49,
    "high": 169.77,
    "low": 169.28,
    "close": 169.29,
    "volume": 918307.0
  },
  {
    "Unnamed: 0.1": 94,
    "Unnamed: 0": 94,
    "time": 1683820200,
    "open": 169.28,
    "high": 169.73,
    "low": 169.22,
    "close": 169.71,
    "volume": 692229.0
  },
  {
    "Unnamed: 0.1": 95,
    "Unnamed: 0": 95,
    "time": 1683820500,
    "open": 169.7,
    "high": 169.86,
    "low": 169.41,
    "close": 169.84,
    "volume": 977608.0
  },
  {
    "Unnamed: 0.1": 96,
    "Unnamed: 0": 96,
    "time": 1683820800,
    "open": 169.85,
    "high": 170.0,
    "low": 169.28,
    "close": 169.28,
    "volume": 927505.0
  },
  {
    "Unnamed: 0.1": 97,
    "Unnamed: 0": 97,
    "time": 1683821100,
    "open": 169.29,
    "high": 169.38,
    "low": 169.09,
    "close": 169.19,
    "volume": 874230.0
  },
  {
    "Unnamed: 0.1": 98,
    "Unnamed: 0": 98,
    "time": 1683821400,
    "open": 169.21,
    "high": 169.22,
    "low": 168.86,
    "close": 169.1,
    "volume": 773267.0
  },
  {
    "Unnamed: 0.1": 99,
    "Unnamed: 0": 99,
    "time": 1683821700,
    "open": 169.1,
    "high": 169.25,
    "low": 168.95,
    "close": 169.19,
    "volume": 686133.0
  },
  {
    "Unnamed: 0.1": 100,
    "Unnamed: 0": 100,
    "time": 1683822000,
    "open": 169.18,
    "high": 169.21,
    "low": 168.92,
    "close": 169.12,
    "volume": 586308.0
  },
  {
    "Unnamed: 0.1": 101,
    "Unnamed: 0": 101,
    "time": 1683822300,
    "open": 169.13,
    "high": 169.21,
    "low": 168.63,
    "close": 168.86,
    "volume": 843922.0
  },
  {
    "Unnamed: 0.1": 102,
    "Unnamed: 0": 102,
    "time": 1683822600,
    "open": 168.86,
    "high": 169.01,
    "low": 168.73,
    "close": 168.82,
    "volume": 569617.0
  },
  {
    "Unnamed: 0.1": 103,
    "Unnamed: 0": 103,
    "time": 1683822900,
    "open": 168.84,
    "high": 169.33,
    "low": 168.82,
    "close": 169.02,
    "volume": 752002.0
  },
  {
    "Unnamed: 0.1": 104,
    "Unnamed: 0": 104,
    "time": 1683823200,
    "open": 169.02,
    "high": 169.38,
    "low": 168.91,
    "close": 169.37,
    "volume": 712948.0
  },
  {
    "Unnamed: 0.1": 105,
    "Unnamed: 0": 105,
    "time": 1683823500,
    "open": 169.37,
    "high": 169.49,
    "low": 169.26,
    "close": 169.37,
    "volume": 601669.0
  },
  {
    "Unnamed: 0.1": 106,
    "Unnamed: 0": 106,
    "time": 1683823800,
    "open": 169.37,
    "high": 169.45,
    "low": 169.13,
    "close": 169.3,
    "volume": 568796.0
  },
  {
    "Unnamed: 0.1": 107,
    "Unnamed: 0": 107,
    "time": 1683824100,
    "open": 169.3,
    "high": 169.35,
    "low": 169.12,
    "close": 169.19,
    "volume": 508243.0
  },
  {
    "Unnamed: 0.1": 108,
    "Unnamed: 0": 108,
    "time": 1683824400,
    "open": 169.19,
    "high": 169.33,
    "low": 168.97,
    "close": 169.24,
    "volume": 608985.0
  },
  {
    "Unnamed: 0.1": 109,
    "Unnamed: 0": 109,
    "time": 1683824700,
    "open": 169.25,
    "high": 169.66,
    "low": 169.14,
    "close": 169.56,
    "volume": 766287.0
  },
  {
    "Unnamed: 0.1": 110,
    "Unnamed: 0": 110,
    "time": 1683825000,
    "open": 169.55,
    "high": 169.7,
    "low": 169.43,
    "close": 169.6,
    "volume": 553446.0
  },
  {
    "Unnamed: 0.1": 111,
    "Unnamed: 0": 111,
    "time": 1683825300,
    "open": 169.59,
    "high": 169.71,
    "low": 169.36,
    "close": 169.48,
    "volume": 572971.0
  },
  {
    "Unnamed: 0.1": 112,
    "Unnamed: 0": 112,
    "time": 1683825600,
    "open": 169.48,
    "high": 169.55,
    "low": 168.95,
    "close": 169.03,
    "volume": 628066.0
  },
  {
    "Unnamed: 0.1": 113,
    "Unnamed: 0": 113,
    "time": 1683825900,
    "open": 169.03,
    "high": 169.22,
    "low": 168.96,
    "close": 169.1,
    "volume": 527008.0
  },
  {
    "Unnamed: 0.1": 114,
    "Unnamed: 0": 114,
    "time": 1683826200,
    "open": 169.12,
    "high": 169.17,
    "low": 168.83,
    "close": 169.11,
    "volume": 761740.0
  },
  {
    "Unnamed: 0.1": 115,
    "Unnamed: 0": 115,
    "time": 1683826500,
    "open": 169.1,
    "high": 169.41,
    "low": 169.0,
    "close": 169.36,
    "volume": 647667.0
  },
  {
    "Unnamed: 0.1": 116,
    "Unnamed: 0": 116,
    "time": 1683826800,
    "open": 169.36,
    "high": 169.39,
    "low": 169.07,
    "close": 169.18,
    "volume": 484676.0
  },
  {
    "Unnamed: 0.1": 117,
    "Unnamed: 0": 117,
    "time": 1683827100,
    "open": 169.16,
    "high": 169.18,
    "low": 168.64,
    "close": 168.79,
    "volume": 795097.0
  },
  {
    "Unnamed: 0.1": 118,
    "Unnamed: 0": 118,
    "time": 1683827400,
    "open": 168.78,
    "high": 169.14,
    "low": 168.67,
    "close": 169.07,
    "volume": 608889.0
  },
  {
    "Unnamed: 0.1": 119,
    "Unnamed: 0": 119,
    "time": 1683827700,
    "open": 169.07,
    "high": 169.38,
    "low": 168.94,
    "close": 169.32,
    "volume": 599885.0
  },
  {
    "Unnamed: 0.1": 120,
    "Unnamed: 0": 120,
    "time": 1683828000,
    "open": 169.35,
    "high": 169.39,
    "low": 169.13,
    "close": 169.25,
    "volume": 438144.0
  },
  {
    "Unnamed: 0.1": 121,
    "Unnamed: 0": 121,
    "time": 1683828300,
    "open": 169.23,
    "high": 169.25,
    "low": 168.96,
    "close": 169.2,
    "volume": 447621.0
  },
  {
    "Unnamed: 0.1": 122,
    "Unnamed: 0": 122,
    "time": 1683828600,
    "open": 169.21,
    "high": 169.32,
    "low": 169.1,
    "close": 169.26,
    "volume": 442499.0
  },
  {
    "Unnamed: 0.1": 123,
    "Unnamed: 0": 123,
    "time": 1683828900,
    "open": 169.27,
    "high": 169.39,
    "low": 169.01,
    "close": 169.21,
    "volume": 514363.0
  },
  {
    "Unnamed: 0.1": 124,
    "Unnamed: 0": 124,
    "time": 1683829200,
    "open": 169.21,
    "high": 169.4,
    "low": 169.05,
    "close": 169.34,
    "volume": 477430.0
  },
  {
    "Unnamed: 0.1": 125,
    "Unnamed: 0": 125,
    "time": 1683829500,
    "open": 169.35,
    "high": 169.49,
    "low": 169.26,
    "close": 169.39,
    "volume": 491107.0
  },
  {
    "Unnamed: 0.1": 126,
    "Unnamed: 0": 126,
    "time": 1683829800,
    "open": 169.41,
    "high": 169.57,
    "low": 169.36,
    "close": 169.52,
    "volume": 505286.0
  },
  {
    "Unnamed: 0.1": 127,
    "Unnamed: 0": 127,
    "time": 1683830100,
    "open": 169.53,
    "high": 169.86,
    "low": 169.47,
    "close": 169.84,
    "volume": 731400.0
  },
  {
    "Unnamed: 0.1": 128,
    "Unnamed: 0": 128,
    "time": 1683830400,
    "open": 169.84,
    "high": 170.14,
    "low": 169.74,
    "close": 170.09,
    "volume": 1070893.0
  },
  {
    "Unnamed: 0.1": 129,
    "Unnamed: 0": 129,
    "time": 1683830700,
    "open": 170.08,
    "high": 170.2,
    "low": 169.93,
    "close": 170.16,
    "volume": 847870.0
  },
  {
    "Unnamed: 0.1": 130,
    "Unnamed: 0": 130,
    "time": 1683831000,
    "open": 170.15,
    "high": 170.18,
    "low": 169.82,
    "close": 169.86,
    "volume": 698704.0
  },
  {
    "Unnamed: 0.1": 131,
    "Unnamed: 0": 131,
    "time": 1683831300,
    "open": 169.87,
    "high": 169.96,
    "low": 169.72,
    "close": 169.95,
    "volume": 619545.0
  },
  {
    "Unnamed: 0.1": 132,
    "Unnamed: 0": 132,
    "time": 1683831600,
    "open": 169.94,
    "high": 170.15,
    "low": 169.83,
    "close": 169.94,
    "volume": 711468.0
  },
  {
    "Unnamed: 0.1": 133,
    "Unnamed: 0": 133,
    "time": 1683831900,
    "open": 169.95,
    "high": 170.38,
    "low": 169.72,
    "close": 170.33,
    "volume": 1121705.0
  },
  {
    "Unnamed: 0.1": 134,
    "Unnamed: 0": 134,
    "time": 1683832200,
    "open": 170.32,
    "high": 170.48,
    "low": 170.26,
    "close": 170.4,
    "volume": 907470.0
  },
  {
    "Unnamed: 0.1": 135,
    "Unnamed: 0": 135,
    "time": 1683832500,
    "open": 170.4,
    "high": 170.41,
    "low": 170.15,
    "close": 170.2,
    "volume": 608436.0
  },
  {
    "Unnamed: 0.1": 136,
    "Unnamed: 0": 136,
    "time": 1683832800,
    "open": 170.19,
    "high": 170.35,
    "low": 170.08,
    "close": 170.23,
    "volume": 660460.0
  },
  {
    "Unnamed: 0.1": 137,
    "Unnamed: 0": 137,
    "time": 1683833100,
    "open": 170.24,
    "high": 170.25,
    "low": 169.92,
    "close": 169.92,
    "volume": 585839.0
  },
  {
    "Unnamed: 0.1": 138,
    "Unnamed: 0": 138,
    "time": 1683833400,
    "open": 169.93,
    "high": 170.06,
    "low": 169.69,
    "close": 169.75,
    "volume": 727056.0
  },
  {
    "Unnamed: 0.1": 139,
    "Unnamed: 0": 139,
    "time": 1683833700,
    "open": 169.75,
    "high": 169.88,
    "low": 169.58,
    "close": 169.6,
    "volume": 653203.0
  },
  {
    "Unnamed: 0.1": 140,
    "Unnamed: 0": 140,
    "time": 1683834000,
    "open": 169.58,
    "high": 171.79,
    "low": 169.36,
    "close": 171.49,
    "volume": 1917575.0
  },
  {
    "Unnamed: 0.1": 141,
    "Unnamed: 0": 141,
    "time": 1683834300,
    "open": 171.52,
    "high": 173.57,
    "low": 171.3,
    "close": 172.92,
    "volume": 5150185.0
  },
  {
    "Unnamed: 0.1": 142,
    "Unnamed: 0": 142,
    "time": 1683834600,
    "open": 172.9,
    "high": 173.1,
    "low": 172.0,
    "close": 172.18,
    "volume": 2744123.0
  },
  {
    "Unnamed: 0.1": 143,
    "Unnamed: 0": 143,
    "time": 1683834900,
    "open": 172.16,
    "high": 172.63,
    "low": 171.76,
    "close": 172.05,
    "volume": 2992652.0
  },
  {
    "Unnamed: 0.1": 144,
    "Unnamed: 0": 144,
    "time": 1683835200,
    "open": 172.05,
    "high": 173.38,
    "low": 172.02,
    "close": 173.26,
    "volume": 1839928.0
  },
  {
    "Unnamed: 0.1": 145,
    "Unnamed: 0": 145,
    "time": 1683835500,
    "open": 173.31,
    "high": 173.45,
    "low": 172.08,
    "close": 172.92,
    "volume": 272329.0
  },
  {
    "Unnamed: 0.1": 146,
    "Unnamed: 0": 146,
    "time": 1683835800,
    "open": 173.0,
    "high": 173.1,
    "low": 172.08,
    "close": 172.49,
    "volume": 233282.0
  },
  {
    "Unnamed: 0.1": 147,
    "Unnamed: 0": 147,
    "time": 1683836100,
    "open": 172.45,
    "high": 173.0,
    "low": 172.08,
    "close": 172.78,
    "volume": 135334.0
  },
  {
    "Unnamed: 0.1": 148,
    "Unnamed: 0": 148,
    "time": 1683836400,
    "open": 172.76,
    "high": 173.12,
    "low": 172.4,
    "close": 173.0,
    "volume": 167268.0
  },
  {
    "Unnamed: 0.1": 149,
    "Unnamed: 0": 149,
    "time": 1683836700,
    "open": 173.01,
    "high": 173.37,
    "low": 172.9,
    "close": 173.23,
    "volume": 177769.0
  },
  {
    "Unnamed: 0.1": 150,
    "Unnamed: 0": 150,
    "time": 1683837000,
    "open": 173.23,
    "high": 173.3,
    "low": 172.92,
    "close": 173.08,
    "volume": 117334.0
  },
  {
    "Unnamed: 0.1": 151,
    "Unnamed: 0": 151,
    "time": 1683837300,
    "open": 173.05,
    "high": 173.14,
    "low": 172.91,
    "close": 172.95,
    "volume": 70470.0
  },
  {
    "Unnamed: 0.1": 152,
    "Unnamed: 0": 152,
    "time": 1683837600,
    "open": 173.0,
    "high": 173.49,
    "low": 172.72,
    "close": 173.45,
    "volume": 125591.0
  },
  {
    "Unnamed: 0.1": 153,
    "Unnamed: 0": 153,
    "time": 1683837900,
    "open": 173.48,
    "high": 173.49,
    "low": 173.09,
    "close": 173.11,
    "volume": 96586.0
  },
  {
    "Unnamed: 0.1": 154,
    "Unnamed: 0": 154,
    "time": 1683838200,
    "open": 173.17,
    "high": 173.44,
    "low": 173.11,
    "close": 173.35,
    "volume": 77595.0
  },
  {
    "Unnamed: 0.1": 155,
    "Unnamed: 0": 155,
    "time": 1683838500,
    "open": 173.33,
    "high": 173.41,
    "low": 173.18,
    "close": 173.25,
    "volume": 44227.0
  },
  {
    "Unnamed: 0.1": 156,
    "Unnamed: 0": 156,
    "time": 1683838800,
    "open": 173.22,
    "high": 173.4,
    "low": 173.2,
    "close": 173.34,
    "volume": 44534.0
  },
  {
    "Unnamed: 0.1": 157,
    "Unnamed: 0": 157,
    "time": 1683839100,
    "open": 173.34,
    "high": 173.5,
    "low": 173.15,
    "close": 173.24,
    "volume": 99984.0
  },
  {
    "Unnamed: 0.1": 158,
    "Unnamed: 0": 158,
    "time": 1683839400,
    "open": 173.25,
    "high": 173.3,
    "low": 173.05,
    "close": 173.16,
    "volume": 58043.0
  },
  {
    "Unnamed: 0.1": 159,
    "Unnamed: 0": 159,
    "time": 1683839700,
    "open": 173.13,
    "high": 173.36,
    "low": 172.08,
    "close": 173.34,
    "volume": 73369.0
  },
  {
    "Unnamed: 0.1": 160,
    "Unnamed: 0": 160,
    "time": 1683840000,
    "open": 173.25,
    "high": 173.32,
    "low": 173.2,
    "close": 173.28,
    "volume": 33389.0
  },
  {
    "Unnamed: 0.1": 161,
    "Unnamed: 0": 161,
    "time": 1683840300,
    "open": 173.27,
    "high": 173.28,
    "low": 173.1,
    "close": 173.11,
    "volume": 42570.0
  },
  {
    "Unnamed: 0.1": 162,
    "Unnamed: 0": 162,
    "time": 1683840600,
    "open": 173.11,
    "high": 173.21,
    "low": 173.05,
    "close": 173.15,
    "volume": 39015.0
  },
  {
    "Unnamed: 0.1": 163,
    "Unnamed: 0": 163,
    "time": 1683840900,
    "open": 173.14,
    "high": 173.17,
    "low": 173.02,
    "close": 173.15,
    "volume": 26384.0
  },
  {
    "Unnamed: 0.1": 164,
    "Unnamed: 0": 164,
    "time": 1683841200,
    "open": 173.1,
    "high": 173.28,
    "low": 173.09,
    "close": 173.21,
    "volume": 36763.0
  },
  {
    "Unnamed: 0.1": 165,
    "Unnamed: 0": 165,
    "time": 1683841500,
    "open": 173.22,
    "high": 173.25,
    "low": 173.12,
    "close": 173.15,
    "volume": 16807.0
  },
  {
    "Unnamed: 0.1": 166,
    "Unnamed: 0": 166,
    "time": 1683841800,
    "open": 173.14,
    "high": 173.23,
    "low": 173.1,
    "close": 173.23,
    "volume": 16052.0
  },
  {
    "Unnamed: 0.1": 167,
    "Unnamed: 0": 167,
    "time": 1683842100,
    "open": 173.16,
    "high": 173.2,
    "low": 173.1,
    "close": 173.12,
    "volume": 11854.0
  },
  {
    "Unnamed: 0.1": 168,
    "Unnamed: 0": 168,
    "time": 1683842400,
    "open": 173.12,
    "high": 173.2,
    "low": 173.11,
    "close": 173.19,
    "volume": 14261.0
  },
  {
    "Unnamed: 0.1": 169,
    "Unnamed: 0": 169,
    "time": 1683842700,
    "open": 173.19,
    "high": 173.33,
    "low": 173.13,
    "close": 173.15,
    "volume": 42028.0
  },
  {
    "Unnamed: 0.1": 170,
    "Unnamed: 0": 170,
    "time": 1683843000,
    "open": 173.2,
    "high": 173.21,
    "low": 173.12,
    "close": 173.18,
    "volume": 19715.0
  },
  {
    "Unnamed: 0.1": 171,
    "Unnamed: 0": 171,
    "time": 1683843300,
    "open": 173.17,
    "high": 173.25,
    "low": 173.13,
    "close": 173.15,
    "volume": 11715.0
  },
  {
    "Unnamed: 0.1": 172,
    "Unnamed: 0": 172,
    "time": 1683843600,
    "open": 173.14,
    "high": 173.2,
    "low": 173.13,
    "close": 173.13,
    "volume": 15128.0
  },
  {
    "Unnamed: 0.1": 173,
    "Unnamed: 0": 173,
    "time": 1683843900,
    "open": 173.16,
    "high": 173.26,
    "low": 173.13,
    "close": 173.21,
    "volume": 16926.0
  },
  {
    "Unnamed: 0.1": 174,
    "Unnamed: 0": 174,
    "time": 1683844200,
    "open": 173.22,
    "high": 173.35,
    "low": 173.2,
    "close": 173.25,
    "volume": 19623.0
  },
  {
    "Unnamed: 0.1": 175,
    "Unnamed: 0": 175,
    "time": 1683844500,
    "open": 173.26,
    "high": 173.35,
    "low": 173.22,
    "close": 173.27,
    "volume": 15263.0
  },
  {
    "Unnamed: 0.1": 176,
    "Unnamed: 0": 176,
    "time": 1683844800,
    "open": 173.28,
    "high": 173.48,
    "low": 173.27,
    "close": 173.39,
    "volume": 21271.0
  },
  {
    "Unnamed: 0.1": 177,
    "Unnamed: 0": 177,
    "time": 1683845100,
    "open": 173.45,
    "high": 173.8,
    "low": 173.45,
    "close": 173.75,
    "volume": 69317.0
  },
  {
    "Unnamed: 0.1": 178,
    "Unnamed: 0": 178,
    "time": 1683845400,
    "open": 173.69,
    "high": 173.85,
    "low": 173.61,
    "close": 173.8,
    "volume": 35236.0
  },
  {
    "Unnamed: 0.1": 179,
    "Unnamed: 0": 179,
    "time": 1683845700,
    "open": 173.82,
    "high": 174.0,
    "low": 173.77,
    "close": 173.97,
    "volume": 44118.0
  },
  {
    "Unnamed: 0.1": 180,
    "Unnamed: 0": 180,
    "time": 1683846000,
    "open": 173.98,
    "high": 174.43,
    "low": 173.96,
    "close": 174.43,
    "volume": 117705.0
  },
  {
    "Unnamed: 0.1": 181,
    "Unnamed: 0": 181,
    "time": 1683846300,
    "open": 174.45,
    "high": 174.49,
    "low": 174.2,
    "close": 174.41,
    "volume": 87048.0
  },
  {
    "Unnamed: 0.1": 182,
    "Unnamed: 0": 182,
    "time": 1683846600,
    "open": 174.44,
    "high": 174.44,
    "low": 174.2,
    "close": 174.38,
    "volume": 67293.0
  },
  {
    "Unnamed: 0.1": 183,
    "Unnamed: 0": 183,
    "time": 1683846900,
    "open": 174.4,
    "high": 174.44,
    "low": 174.27,
    "close": 174.41,
    "volume": 51391.0
  },
  {
    "Unnamed: 0.1": 184,
    "Unnamed: 0": 184,
    "time": 1683847200,
    "open": 174.43,
    "high": 174.48,
    "low": 174.25,
    "close": 174.3,
    "volume": 71590.0
  },
  {
    "Unnamed: 0.1": 185,
    "Unnamed: 0": 185,
    "time": 1683847500,
    "open": 174.29,
    "high": 174.31,
    "low": 174.1,
    "close": 174.26,
    "volume": 46928.0
  },
  {
    "Unnamed: 0.1": 186,
    "Unnamed: 0": 186,
    "time": 1683847800,
    "open": 174.28,
    "high": 174.49,
    "low": 174.25,
    "close": 174.49,
    "volume": 50255.0
  },
  {
    "Unnamed: 0.1": 187,
    "Unnamed: 0": 187,
    "time": 1683848100,
    "open": 174.47,
    "high": 174.79,
    "low": 174.45,
    "close": 174.7,
    "volume": 98644.0
  },
  {
    "Unnamed: 0.1": 188,
    "Unnamed: 0": 188,
    "time": 1683848400,
    "open": 174.7,
    "high": 174.87,
    "low": 174.64,
    "close": 174.71,
    "volume": 75437.0
  },
  {
    "Unnamed: 0.1": 189,
    "Unnamed: 0": 189,
    "time": 1683848700,
    "open": 174.72,
    "high": 174.9,
    "low": 174.72,
    "close": 174.83,
    "volume": 51910.0
  },
  {
    "Unnamed: 0.1": 190,
    "Unnamed: 0": 190,
    "time": 1683849000,
    "open": 174.83,
    "high": 174.87,
    "low": 174.75,
    "close": 174.75,
    "volume": 59984.0
  },
  {
    "Unnamed: 0.1": 191,
    "Unnamed: 0": 191,
    "time": 1683849300,
    "open": 174.76,
    "high": 174.86,
    "low": 174.67,
    "close": 174.76,
    "volume": 90335.0
  },
  {
    "Unnamed: 0.1": 192,
    "Unnamed: 0": 192,
    "time": 1683878400,
    "open": 174.65,
    "high": 175.0,
    "low": 173.8,
    "close": 173.98,
    "volume": 25600.0
  },
  {
    "Unnamed: 0.1": 193,
    "Unnamed: 0": 193,
    "time": 1683878700,
    "open": 173.91,
    "high": 174.19,
    "low": 173.9,
    "close": 174.12,
    "volume": 7795.0
  },
  {
    "Unnamed: 0.1": 194,
    "Unnamed: 0": 194,
    "time": 1683879000,
    "open": 174.1,
    "high": 174.38,
    "low": 174.09,
    "close": 174.37,
    "volume": 9569.0
  },
  {
    "Unnamed: 0.1": 195,
    "Unnamed: 0": 195,
    "time": 1683879300,
    "open": 174.31,
    "high": 174.4,
    "low": 174.2,
    "close": 174.25,
    "volume": 3106.0
  },
  {
    "Unnamed: 0.1": 196,
    "Unnamed: 0": 196,
    "time": 1683879600,
    "open": 174.34,
    "high": 174.34,
    "low": 174.23,
    "close": 174.34,
    "volume": 3177.0
  },
  {
    "Unnamed: 0.1": 197,
    "Unnamed: 0": 197,
    "time": 1683879900,
    "open": 174.35,
    "high": 174.36,
    "low": 174.25,
    "close": 174.32,
    "volume": 5877.0
  },
  {
    "Unnamed: 0.1": 198,
    "Unnamed: 0": 198,
    "time": 1683880200,
    "open": 174.32,
    "high": 174.32,
    "low": 174.05,
    "close": 174.12,
    "volume": 7369.0
  },
  {
    "Unnamed: 0.1": 199,
    "Unnamed: 0": 199,
    "time": 1683880500,
    "open": 174.06,
    "high": 174.28,
    "low": 174.05,
    "close": 174.28,
    "volume": 3375.0
  },
  {
    "Unnamed: 0.1": 200,
    "Unnamed: 0": 200,
    "time": 1683880800,
    "open": 174.29,
    "high": 174.32,
    "low": 174.29,
    "close": 174.3,
    "volume": 5881.0
  },
  {
    "Unnamed: 0.1": 201,
    "Unnamed: 0": 201,
    "time": 1683881100,
    "open": 174.2,
    "high": 174.22,
    "low": 174.2,
    "close": 174.22,
    "volume": 250.0
  },
  {
    "Unnamed: 0.1": 202,
    "Unnamed: 0": 202,
    "time": 1683881400,
    "open": 174.25,
    "high": 174.25,
    "low": 174.15,
    "close": 174.15,
    "volume": 450.0
  },
  {
    "Unnamed: 0.1": 203,
    "Unnamed: 0": 203,
    "time": 1683881700,
    "open": 174.18,
    "high": 174.3,
    "low": 174.18,
    "close": 174.3,
    "volume": 2453.0
  },
  {
    "Unnamed: 0.1": 204,
    "Unnamed: 0": 204,
    "time": 1683882000,
    "open": 174.3,
    "high": 174.36,
    "low": 174.3,
    "close": 174.35,
    "volume": 3817.0
  },
  {
    "Unnamed: 0.1": 205,
    "Unnamed: 0": 205,
    "time": 1683882300,
    "open": 174.3,
    "high": 174.75,
    "low": 174.3,
    "close": 174.75,
    "volume": 7592.0
  },
  {
    "Unnamed: 0.1": 206,
    "Unnamed: 0": 206,
    "time": 1683882600,
    "open": 174.77,
    "high": 174.77,
    "low": 174.65,
    "close": 174.72,
    "volume": 9342.0
  },
  {
    "Unnamed: 0.1": 207,
    "Unnamed: 0": 207,
    "time": 1683882900,
    "open": 174.72,
    "high": 174.72,
    "low": 174.36,
    "close": 174.45,
    "volume": 2729.0
  },
  {
    "Unnamed: 0.1": 208,
    "Unnamed: 0": 208,
    "time": 1683883200,
    "open": 174.55,
    "high": 174.56,
    "low": 174.5,
    "close": 174.5,
    "volume": 850.0
  },
  {
    "Unnamed: 0.1": 209,
    "Unnamed: 0": 209,
    "time": 1683883500,
    "open": 174.5,
    "high": 174.57,
    "low": 174.48,
    "close": 174.48,
    "volume": 2885.0
  },
  {
    "Unnamed: 0.1": 210,
    "Unnamed: 0": 210,
    "time": 1683883800,
    "open": 174.56,
    "high": 174.86,
    "low": 174.56,
    "close": 174.86,
    "volume": 8667.0
  },
  {
    "Unnamed: 0.1": 211,
    "Unnamed: 0": 211,
    "time": 1683884100,
    "open": 174.88,
    "high": 175.0,
    "low": 174.87,
    "close": 174.9,
    "volume": 9349.0
  },
  {
    "Unnamed: 0.1": 212,
    "Unnamed: 0": 212,
    "time": 1683884400,
    "open": 174.78,
    "high": 174.78,
    "low": 174.66,
    "close": 174.72,
    "volume": 4503.0
  },
  {
    "Unnamed: 0.1": 213,
    "Unnamed: 0": 213,
    "time": 1683884700,
    "open": 174.76,
    "high": 174.8,
    "low": 174.71,
    "close": 174.74,
    "volume": 2232.0
  },
  {
    "Unnamed: 0.1": 214,
    "Unnamed: 0": 214,
    "time": 1683885000,
    "open": 174.76,
    "high": 174.76,
    "low": 174.66,
    "close": 174.66,
    "volume": 1306.0
  },
  {
    "Unnamed: 0.1": 215,
    "Unnamed: 0": 215,
    "time": 1683885300,
    "open": 174.66,
    "high": 174.66,
    "low": 174.14,
    "close": 174.21,
    "volume": 15389.0
  },
  {
    "Unnamed: 0.1": 216,
    "Unnamed: 0": 216,
    "time": 1683885600,
    "open": 174.25,
    "high": 174.35,
    "low": 174.25,
    "close": 174.35,
    "volume": 952.0
  },
  {
    "Unnamed: 0.1": 217,
    "Unnamed: 0": 217,
    "time": 1683885900,
    "open": 174.38,
    "high": 174.42,
    "low": 174.31,
    "close": 174.31,
    "volume": 3402.0
  },
  {
    "Unnamed: 0.1": 218,
    "Unnamed: 0": 218,
    "time": 1683886200,
    "open": 174.31,
    "high": 174.31,
    "low": 174.3,
    "close": 174.31,
    "volume": 3338.0
  },
  {
    "Unnamed: 0.1": 219,
    "Unnamed: 0": 219,
    "time": 1683886500,
    "open": 174.28,
    "high": 174.28,
    "low": 174.13,
    "close": 174.16,
    "volume": 2683.0
  },
  {
    "Unnamed: 0.1": 220,
    "Unnamed: 0": 220,
    "time": 1683886800,
    "open": 174.19,
    "high": 174.76,
    "low": 174.1,
    "close": 174.54,
    "volume": 10368.0
  },
  {
    "Unnamed: 0.1": 221,
    "Unnamed: 0": 221,
    "time": 1683887100,
    "open": 174.4,
    "high": 174.41,
    "low": 174.4,
    "close": 174.41,
    "volume": 881.0
  },
  {
    "Unnamed: 0.1": 222,
    "Unnamed: 0": 222,
    "time": 1683887400,
    "open": 174.49,
    "high": 174.75,
    "low": 174.48,
    "close": 174.74,
    "volume": 4918.0
  },
  {
    "Unnamed: 0.1": 223,
    "Unnamed: 0": 223,
    "time": 1683887700,
    "open": 174.62,
    "high": 174.67,
    "low": 174.58,
    "close": 174.67,
    "volume": 2881.0
  },
  {
    "Unnamed: 0.1": 224,
    "Unnamed: 0": 224,
    "time": 1683888000,
    "open": 174.56,
    "high": 174.65,
    "low": 174.51,
    "close": 174.54,
    "volume": 3699.0
  },
  {
    "Unnamed: 0.1": 225,
    "Unnamed: 0": 225,
    "time": 1683888300,
    "open": 174.54,
    "high": 174.55,
    "low": 174.3,
    "close": 174.4,
    "volume": 6425.0
  },
  {
    "Unnamed: 0.1": 226,
    "Unnamed: 0": 226,
    "time": 1683888600,
    "open": 174.5,
    "high": 174.66,
    "low": 174.47,
    "close": 174.5,
    "volume": 7545.0
  },
  {
    "Unnamed: 0.1": 227,
    "Unnamed: 0": 227,
    "time": 1683888900,
    "open": 174.58,
    "high": 174.9,
    "low": 174.58,
    "close": 174.89,
    "volume": 14851.0
  },
  {
    "Unnamed: 0.1": 228,
    "Unnamed: 0": 228,
    "time": 1683889200,
    "open": 174.8,
    "high": 175.4,
    "low": 174.6,
    "close": 175.15,
    "volume": 124101.0
  },
  {
    "Unnamed: 0.1": 229,
    "Unnamed: 0": 229,
    "time": 1683889500,
    "open": 175.15,
    "high": 175.77,
    "low": 175.1,
    "close": 175.6,
    "volume": 90365.0
  },
  {
    "Unnamed: 0.1": 230,
    "Unnamed: 0": 230,
    "time": 1683889800,
    "open": 175.55,
    "high": 175.97,
    "low": 175.55,
    "close": 175.96,
    "volume": 89280.0
  },
  {
    "Unnamed: 0.1": 231,
    "Unnamed: 0": 231,
    "time": 1683890100,
    "open": 175.97,
    "high": 176.36,
    "low": 175.9,
    "close": 176.18,
    "volume": 131601.0
  },
  {
    "Unnamed: 0.1": 232,
    "Unnamed: 0": 232,
    "time": 1683890400,
    "open": 176.18,
    "high": 176.49,
    "low": 175.96,
    "close": 176.18,
    "volume": 100515.0
  },
  {
    "Unnamed: 0.1": 233,
    "Unnamed: 0": 233,
    "time": 1683890700,
    "open": 176.2,
    "high": 176.3,
    "low": 175.71,
    "close": 175.86,
    "volume": 84076.0
  },
  {
    "Unnamed: 0.1": 234,
    "Unnamed: 0": 234,
    "time": 1683891000,
    "open": 175.81,
    "high": 175.98,
    "low": 175.64,
    "close": 175.9,
    "volume": 42385.0
  },
  {
    "Unnamed: 0.1": 235,
    "Unnamed: 0": 235,
    "time": 1683891300,
    "open": 175.9,
    "high": 175.99,
    "low": 175.7,
    "close": 175.81,
    "volume": 16916.0
  },
  {
    "Unnamed: 0.1": 236,
    "Unnamed: 0": 236,
    "time": 1683891600,
    "open": 175.8,
    "high": 176.2,
    "low": 175.75,
    "close": 176.1,
    "volume": 34655.0
  },
  {
    "Unnamed: 0.1": 237,
    "Unnamed: 0": 237,
    "time": 1683891900,
    "open": 176.1,
    "high": 176.14,
    "low": 175.95,
    "close": 176.0,
    "volume": 37689.0
  },
  {
    "Unnamed: 0.1": 238,
    "Unnamed: 0": 238,
    "time": 1683892200,
    "open": 175.99,
    "high": 175.99,
    "low": 175.71,
    "close": 175.84,
    "volume": 25276.0
  },
  {
    "Unnamed: 0.1": 239,
    "Unnamed: 0": 239,
    "time": 1683892500,
    "open": 175.83,
    "high": 175.83,
    "low": 175.36,
    "close": 175.7,
    "volume": 51049.0
  },
  {
    "Unnamed: 0.1": 240,
    "Unnamed: 0": 240,
    "time": 1683892800,
    "open": 174.83,
    "high": 176.49,
    "low": 172.91,
    "close": 175.5,
    "volume": 341838.0
  },
  {
    "Unnamed: 0.1": 241,
    "Unnamed: 0": 241,
    "time": 1683893100,
    "open": 175.5,
    "high": 175.75,
    "low": 175.31,
    "close": 175.6,
    "volume": 74312.0
  },
  {
    "Unnamed: 0.1": 242,
    "Unnamed: 0": 242,
    "time": 1683893400,
    "open": 175.63,
    "high": 175.99,
    "low": 175.59,
    "close": 175.98,
    "volume": 117943.0
  },
  {
    "Unnamed: 0.1": 243,
    "Unnamed: 0": 243,
    "time": 1683893700,
    "open": 175.97,
    "high": 176.1,
    "low": 175.5,
    "close": 175.52,
    "volume": 93100.0
  },
  {
    "Unnamed: 0.1": 244,
    "Unnamed: 0": 244,
    "time": 1683894000,
    "open": 175.59,
    "high": 175.75,
    "low": 175.52,
    "close": 175.68,
    "volume": 52855.0
  },
  {
    "Unnamed: 0.1": 245,
    "Unnamed: 0": 245,
    "time": 1683894300,
    "open": 175.69,
    "high": 175.73,
    "low": 175.4,
    "close": 175.44,
    "volume": 78346.0
  },
  {
    "Unnamed: 0.1": 246,
    "Unnamed: 0": 246,
    "time": 1683894600,
    "open": 175.5,
    "high": 175.88,
    "low": 175.3,
    "close": 175.7,
    "volume": 93311.0
  },
  {
    "Unnamed: 0.1": 247,
    "Unnamed: 0": 247,
    "time": 1683894900,
    "open": 175.66,
    "high": 175.79,
    "low": 175.6,
    "close": 175.63,
    "volume": 56225.0
  },
  {
    "Unnamed: 0.1": 248,
    "Unnamed: 0": 248,
    "time": 1683895200,
    "open": 175.6,
    "high": 176.22,
    "low": 175.6,
    "close": 176.1,
    "volume": 118222.0
  },
  {
    "Unnamed: 0.1": 249,
    "Unnamed: 0": 249,
    "time": 1683895500,
    "open": 176.1,
    "high": 176.27,
    "low": 175.8,
    "close": 176.21,
    "volume": 113236.0
  },
  {
    "Unnamed: 0.1": 250,
    "Unnamed: 0": 250,
    "time": 1683895800,
    "open": 176.23,
    "high": 176.36,
    "low": 176.06,
    "close": 176.15,
    "volume": 132576.0
  },
  {
    "Unnamed: 0.1": 251,
    "Unnamed: 0": 251,
    "time": 1683896100,
    "open": 176.09,
    "high": 176.15,
    "low": 175.69,
    "close": 175.7,
    "volume": 128299.0
  },
  {
    "Unnamed: 0.1": 252,
    "Unnamed: 0": 252,
    "time": 1683896400,
    "open": 175.82,
    "high": 175.84,
    "low": 175.61,
    "close": 175.84,
    "volume": 84120.0
  },
  {
    "Unnamed: 0.1": 253,
    "Unnamed: 0": 253,
    "time": 1683896700,
    "open": 175.83,
    "high": 175.95,
    "low": 175.75,
    "close": 175.88,
    "volume": 53316.0
  },
  {
    "Unnamed: 0.1": 254,
    "Unnamed: 0": 254,
    "time": 1683897000,
    "open": 175.9,
    "high": 176.29,
    "low": 175.89,
    "close": 176.2,
    "volume": 107272.0
  },
  {
    "Unnamed: 0.1": 255,
    "Unnamed: 0": 255,
    "time": 1683897300,
    "open": 176.2,
    "high": 176.25,
    "low": 175.75,
    "close": 175.78,
    "volume": 68160.0
  },
  {
    "Unnamed: 0.1": 256,
    "Unnamed: 0": 256,
    "time": 1683897600,
    "open": 175.8,
    "high": 176.1,
    "low": 175.75,
    "close": 176.03,
    "volume": 66388.0
  },
  {
    "Unnamed: 0.1": 257,
    "Unnamed: 0": 257,
    "time": 1683897900,
    "open": 176.0,
    "high": 176.15,
    "low": 175.76,
    "close": 176.05,
    "volume": 159084.0
  },
  {
    "Unnamed: 0.1": 258,
    "Unnamed: 0": 258,
    "time": 1683898200,
    "open": 176.07,
    "high": 176.73,
    "low": 174.6,
    "close": 176.07,
    "volume": 5421951.0
  },
  {
    "Unnamed: 0.1": 259,
    "Unnamed: 0": 259,
    "time": 1683898500,
    "open": 176.06,
    "high": 176.94,
    "low": 175.3,
    "close": 176.25,
    "volume": 4610796.0
  },
  {
    "Unnamed: 0.1": 260,
    "Unnamed: 0": 260,
    "time": 1683898800,
    "open": 176.26,
    "high": 177.28,
    "low": 176.22,
    "close": 176.99,
    "volume": 3592232.0
  },
  {
    "Unnamed: 0.1": 261,
    "Unnamed: 0": 261,
    "time": 1683899100,
    "open": 176.98,
    "high": 177.29,
    "low": 175.72,
    "close": 175.76,
    "volume": 3112590.0
  },
  {
    "Unnamed: 0.1": 262,
    "Unnamed: 0": 262,
    "time": 1683899400,
    "open": 175.77,
    "high": 177.38,
    "low": 175.58,
    "close": 177.2,
    "volume": 3407487.0
  },
  {
    "Unnamed: 0.1": 263,
    "Unnamed: 0": 263,
    "time": 1683899700,
    "open": 177.19,
    "high": 177.26,
    "low": 176.03,
    "close": 176.11,
    "volume": 2444745.0
  },
  {
    "Unnamed: 0.1": 264,
    "Unnamed: 0": 264,
    "time": 1683900000,
    "open": 176.11,
    "high": 176.5,
    "low": 174.22,
    "close": 174.62,
    "volume": 3894326.0
  },
  {
    "Unnamed: 0.1": 265,
    "Unnamed: 0": 265,
    "time": 1683900300,
    "open": 174.62,
    "high": 174.69,
    "low": 173.6,
    "close": 174.51,
    "volume": 3415545.0
  },
  {
    "Unnamed: 0.1": 266,
    "Unnamed: 0": 266,
    "time": 1683900600,
    "open": 174.52,
    "high": 174.81,
    "low": 173.71,
    "close": 174.07,
    "volume": 2664291.0
  },
  {
    "Unnamed: 0.1": 267,
    "Unnamed: 0": 267,
    "time": 1683900900,
    "open": 174.08,
    "high": 174.34,
    "low": 173.58,
    "close": 173.78,
    "volume": 2411572.0
  },
  {
    "Unnamed: 0.1": 268,
    "Unnamed: 0": 268,
    "time": 1683901200,
    "open": 173.76,
    "high": 174.06,
    "low": 172.63,
    "close": 173.48,
    "volume": 3018944.0
  },
  {
    "Unnamed: 0.1": 269,
    "Unnamed: 0": 269,
    "time": 1683901500,
    "open": 173.48,
    "high": 173.55,
    "low": 171.84,
    "close": 171.97,
    "volume": 2499166.0
  },
  {
    "Unnamed: 0.1": 270,
    "Unnamed: 0": 270,
    "time": 1683901800,
    "open": 171.96,
    "high": 172.15,
    "low": 171.37,
    "close": 171.67,
    "volume": 2583874.0
  },
  {
    "Unnamed: 0.1": 271,
    "Unnamed: 0": 271,
    "time": 1683902100,
    "open": 171.67,
    "high": 172.65,
    "low": 171.6,
    "close": 172.54,
    "volume": 2257025.0
  },
  {
    "Unnamed: 0.1": 272,
    "Unnamed: 0": 272,
    "time": 1683902400,
    "open": 172.53,
    "high": 172.56,
    "low": 172.0,
    "close": 172.42,
    "volume": 1406958.0
  },
  {
    "Unnamed: 0.1": 273,
    "Unnamed: 0": 273,
    "time": 1683902700,
    "open": 172.4,
    "high": 172.9,
    "low": 172.38,
    "close": 172.7,
    "volume": 1664103.0
  },
  {
    "Unnamed: 0.1": 274,
    "Unnamed: 0": 274,
    "time": 1683903000,
    "open": 172.71,
    "high": 172.97,
    "low": 172.03,
    "close": 172.26,
    "volume": 1647655.0
  },
  {
    "Unnamed: 0.1": 275,
    "Unnamed: 0": 275,
    "time": 1683903300,
    "open": 172.26,
    "high": 172.53,
    "low": 171.15,
    "close": 171.96,
    "volume": 2196130.0
  },
  {
    "Unnamed: 0.1": 276,
    "Unnamed: 0": 276,
    "time": 1683903600,
    "open": 171.95,
    "high": 172.43,
    "low": 171.81,
    "close": 172.38,
    "volume": 1799281.0
  },
  {
    "Unnamed: 0.1": 277,
    "Unnamed: 0": 277,
    "time": 1683903900,
    "open": 172.38,
    "high": 172.6,
    "low": 171.51,
    "close": 171.57,
    "volume": 1469645.0
  },
  {
    "Unnamed: 0.1": 278,
    "Unnamed: 0": 278,
    "time": 1683904200,
    "open": 171.58,
    "high": 171.96,
    "low": 171.25,
    "close": 171.49,
    "volume": 1518577.0
  },
  {
    "Unnamed: 0.1": 279,
    "Unnamed: 0": 279,
    "time": 1683904500,
    "open": 171.48,
    "high": 171.66,
    "low": 170.81,
    "close": 170.83,
    "volume": 1778733.0
  },
  {
    "Unnamed: 0.1": 280,
    "Unnamed: 0": 280,
    "time": 1683904800,
    "open": 170.83,
    "high": 171.57,
    "low": 170.68,
    "close": 170.89,
    "volume": 1606170.0
  },
  {
    "Unnamed: 0.1": 281,
    "Unnamed: 0": 281,
    "time": 1683905100,
    "open": 170.9,
    "high": 171.1,
    "low": 170.19,
    "close": 170.21,
    "volume": 1909691.0
  },
  {
    "Unnamed: 0.1": 282,
    "Unnamed: 0": 282,
    "time": 1683905400,
    "open": 170.21,
    "high": 170.46,
    "low": 169.55,
    "close": 169.66,
    "volume": 2384919.0
  },
  {
    "Unnamed: 0.1": 283,
    "Unnamed: 0": 283,
    "time": 1683905700,
    "open": 169.67,
    "high": 169.67,
    "low": 168.75,
    "close": 169.38,
    "volume": 2696877.0
  },
  {
    "Unnamed: 0.1": 284,
    "Unnamed: 0": 284,
    "time": 1683906000,
    "open": 169.38,
    "high": 169.74,
    "low": 169.31,
    "close": 169.36,
    "volume": 1440487.0
  },
  {
    "Unnamed: 0.1": 285,
    "Unnamed: 0": 285,
    "time": 1683906300,
    "open": 169.34,
    "high": 169.88,
    "low": 169.33,
    "close": 169.6,
    "volume": 1154864.0
  },
  {
    "Unnamed: 0.1": 286,
    "Unnamed: 0": 286,
    "time": 1683906600,
    "open": 169.61,
    "high": 169.84,
    "low": 169.35,
    "close": 169.52,
    "volume": 1230582.0
  },
  {
    "Unnamed: 0.1": 287,
    "Unnamed: 0": 287,
    "time": 1683906900,
    "open": 169.54,
    "high": 170.3,
    "low": 169.51,
    "close": 170.26,
    "volume": 1573767.0
  },
  {
    "Unnamed: 0.1": 288,
    "Unnamed: 0": 288,
    "time": 1683907200,
    "open": 170.27,
    "high": 170.28,
    "low": 169.0,
    "close": 169.0,
    "volume": 1560080.0
  },
  {
    "Unnamed: 0.1": 289,
    "Unnamed: 0": 289,
    "time": 1683907500,
    "open": 169.0,
    "high": 169.37,
    "low": 168.85,
    "close": 169.26,
    "volume": 1360592.0
  },
  {
    "Unnamed: 0.1": 290,
    "Unnamed: 0": 290,
    "time": 1683907800,
    "open": 169.24,
    "high": 170.0,
    "low": 169.18,
    "close": 169.4,
    "volume": 1807020.0
  },
  {
    "Unnamed: 0.1": 291,
    "Unnamed: 0": 291,
    "time": 1683908100,
    "open": 169.4,
    "high": 169.64,
    "low": 168.1,
    "close": 168.5,
    "volume": 2169578.0
  },
  {
    "Unnamed: 0.1": 292,
    "Unnamed: 0": 292,
    "time": 1683908400,
    "open": 168.52,
    "high": 168.68,
    "low": 167.61,
    "close": 167.88,
    "volume": 2106144.0
  },
  {
    "Unnamed: 0.1": 293,
    "Unnamed: 0": 293,
    "time": 1683908700,
    "open": 167.9,
    "high": 168.28,
    "low": 167.81,
    "close": 167.98,
    "volume": 1306197.0
  },
  {
    "Unnamed: 0.1": 294,
    "Unnamed: 0": 294,
    "time": 1683909000,
    "open": 167.98,
    "high": 168.72,
    "low": 167.85,
    "close": 168.68,
    "volume": 1547077.0
  },
  {
    "Unnamed: 0.1": 295,
    "Unnamed: 0": 295,
    "time": 1683909300,
    "open": 168.69,
    "high": 168.8,
    "low": 167.97,
    "close": 168.21,
    "volume": 1430926.0
  },
  {
    "Unnamed: 0.1": 296,
    "Unnamed: 0": 296,
    "time": 1683909600,
    "open": 168.23,
    "high": 168.32,
    "low": 167.8,
    "close": 167.8,
    "volume": 1189690.0
  },
  {
    "Unnamed: 0.1": 297,
    "Unnamed: 0": 297,
    "time": 1683909900,
    "open": 167.8,
    "high": 167.89,
    "low": 167.5,
    "close": 167.65,
    "volume": 1552147.0
  },
  {
    "Unnamed: 0.1": 298,
    "Unnamed: 0": 298,
    "time": 1683910200,
    "open": 167.65,
    "high": 167.97,
    "low": 167.23,
    "close": 167.38,
    "volume": 1385879.0
  },
  {
    "Unnamed: 0.1": 299,
    "Unnamed: 0": 299,
    "time": 1683910500,
    "open": 167.38,
    "high": 167.96,
    "low": 167.27,
    "close": 167.81,
    "volume": 1089610.0
  },
  {
    "Unnamed: 0.1": 300,
    "Unnamed: 0": 300,
    "time": 1683910800,
    "open": 167.81,
    "high": 168.1,
    "low": 167.66,
    "close": 167.96,
    "volume": 1060447.0
  },
  {
    "Unnamed: 0.1": 301,
    "Unnamed: 0": 301,
    "time": 1683911100,
    "open": 167.96,
    "high": 168.13,
    "low": 167.67,
    "close": 168.12,
    "volume": 994965.0
  },
  {
    "Unnamed: 0.1": 302,
    "Unnamed: 0": 302,
    "time": 1683911400,
    "open": 168.13,
    "high": 168.39,
    "low": 167.97,
    "close": 168.03,
    "volume": 1048343.0
  },
  {
    "Unnamed: 0.1": 303,
    "Unnamed: 0": 303,
    "time": 1683911700,
    "open": 168.03,
    "high": 168.31,
    "low": 168.0,
    "close": 168.06,
    "volume": 834824.0
  },
  {
    "Unnamed: 0.1": 304,
    "Unnamed: 0": 304,
    "time": 1683912000,
    "open": 168.04,
    "high": 168.59,
    "low": 167.77,
    "close": 168.56,
    "volume": 1330379.0
  },
  {
    "Unnamed: 0.1": 305,
    "Unnamed: 0": 305,
    "time": 1683912300,
    "open": 168.55,
    "high": 168.63,
    "low": 168.22,
    "close": 168.32,
    "volume": 816795.0
  },
  {
    "Unnamed: 0.1": 306,
    "Unnamed: 0": 306,
    "time": 1683912600,
    "open": 168.33,
    "high": 168.7,
    "low": 168.25,
    "close": 168.29,
    "volume": 976977.0
  },
  {
    "Unnamed: 0.1": 307,
    "Unnamed: 0": 307,
    "time": 1683912900,
    "open": 168.28,
    "high": 168.28,
    "low": 167.88,
    "close": 168.17,
    "volume": 939837.0
  },
  {
    "Unnamed: 0.1": 308,
    "Unnamed: 0": 308,
    "time": 1683913200,
    "open": 168.17,
    "high": 168.53,
    "low": 168.08,
    "close": 168.44,
    "volume": 776443.0
  },
  {
    "Unnamed: 0.1": 309,
    "Unnamed: 0": 309,
    "time": 1683913500,
    "open": 168.43,
    "high": 168.51,
    "low": 168.21,
    "close": 168.33,
    "volume": 619985.0
  },
  {
    "Unnamed: 0.1": 310,
    "Unnamed: 0": 310,
    "time": 1683913800,
    "open": 168.32,
    "high": 168.39,
    "low": 168.02,
    "close": 168.09,
    "volume": 702217.0
  },
  {
    "Unnamed: 0.1": 311,
    "Unnamed: 0": 311,
    "time": 1683914100,
    "open": 168.09,
    "high": 168.19,
    "low": 167.59,
    "close": 167.74,
    "volume": 1059951.0
  },
  {
    "Unnamed: 0.1": 312,
    "Unnamed: 0": 312,
    "time": 1683914400,
    "open": 167.76,
    "high": 168.01,
    "low": 167.39,
    "close": 167.89,
    "volume": 1066842.0
  },
  {
    "Unnamed: 0.1": 313,
    "Unnamed: 0": 313,
    "time": 1683914700,
    "open": 167.88,
    "high": 168.04,
    "low": 167.67,
    "close": 167.9,
    "volume": 787063.0
  },
  {
    "Unnamed: 0.1": 314,
    "Unnamed: 0": 314,
    "time": 1683915000,
    "open": 167.89,
    "high": 168.19,
    "low": 167.75,
    "close": 167.87,
    "volume": 853241.0
  },
  {
    "Unnamed: 0.1": 315,
    "Unnamed: 0": 315,
    "time": 1683915300,
    "open": 167.9,
    "high": 168.15,
    "low": 167.8,
    "close": 168.07,
    "volume": 676123.0
  },
  {
    "Unnamed: 0.1": 316,
    "Unnamed: 0": 316,
    "time": 1683915600,
    "open": 168.05,
    "high": 168.15,
    "low": 167.86,
    "close": 168.03,
    "volume": 767873.0
  },
  {
    "Unnamed: 0.1": 317,
    "Unnamed: 0": 317,
    "time": 1683915900,
    "open": 168.03,
    "high": 168.24,
    "low": 167.82,
    "close": 167.85,
    "volume": 960966.0
  },
  {
    "Unnamed: 0.1": 318,
    "Unnamed: 0": 318,
    "time": 1683916200,
    "open": 167.84,
    "high": 168.03,
    "low": 167.33,
    "close": 167.7,
    "volume": 1331390.0
  },
  {
    "Unnamed: 0.1": 319,
    "Unnamed: 0": 319,
    "time": 1683916500,
    "open": 167.72,
    "high": 167.83,
    "low": 167.52,
    "close": 167.65,
    "volume": 799072.0
  },
  {
    "Unnamed: 0.1": 320,
    "Unnamed: 0": 320,
    "time": 1683916800,
    "open": 167.64,
    "high": 167.92,
    "low": 167.56,
    "close": 167.8,
    "volume": 795175.0
  },
  {
    "Unnamed: 0.1": 321,
    "Unnamed: 0": 321,
    "time": 1683917100,
    "open": 167.8,
    "high": 167.93,
    "low": 167.71,
    "close": 167.84,
    "volume": 564454.0
  },
  {
    "Unnamed: 0.1": 322,
    "Unnamed: 0": 322,
    "time": 1683917400,
    "open": 167.84,
    "high": 167.99,
    "low": 167.76,
    "close": 167.89,
    "volume": 709286.0
  },
  {
    "Unnamed: 0.1": 323,
    "Unnamed: 0": 323,
    "time": 1683917700,
    "open": 167.88,
    "high": 167.93,
    "low": 167.6,
    "close": 167.89,
    "volume": 714479.0
  },
  {
    "Unnamed: 0.1": 324,
    "Unnamed: 0": 324,
    "time": 1683918000,
    "open": 167.88,
    "high": 168.12,
    "low": 167.8,
    "close": 167.98,
    "volume": 1034909.0
  },
  {
    "Unnamed: 0.1": 325,
    "Unnamed: 0": 325,
    "time": 1683918300,
    "open": 167.95,
    "high": 168.21,
    "low": 167.78,
    "close": 168.17,
    "volume": 829686.0
  },
  {
    "Unnamed: 0.1": 326,
    "Unnamed: 0": 326,
    "time": 1683918600,
    "open": 168.16,
    "high": 168.47,
    "low": 168.14,
    "close": 168.44,
    "volume": 1103565.0
  },
  {
    "Unnamed: 0.1": 327,
    "Unnamed: 0": 327,
    "time": 1683918900,
    "open": 168.44,
    "high": 168.54,
    "low": 168.29,
    "close": 168.44,
    "volume": 806181.0
  },
  {
    "Unnamed: 0.1": 328,
    "Unnamed: 0": 328,
    "time": 1683919200,
    "open": 168.45,
    "high": 168.55,
    "low": 168.39,
    "close": 168.52,
    "volume": 866578.0
  },
  {
    "Unnamed: 0.1": 329,
    "Unnamed: 0": 329,
    "time": 1683919500,
    "open": 168.53,
    "high": 168.94,
    "low": 168.48,
    "close": 168.7,
    "volume": 1515698.0
  },
  {
    "Unnamed: 0.1": 330,
    "Unnamed: 0": 330,
    "time": 1683919800,
    "open": 168.71,
    "high": 169.04,
    "low": 168.39,
    "close": 168.6,
    "volume": 1328396.0
  },
  {
    "Unnamed: 0.1": 331,
    "Unnamed: 0": 331,
    "time": 1683920100,
    "open": 168.6,
    "high": 168.78,
    "low": 168.06,
    "close": 168.13,
    "volume": 1326113.0
  },
  {
    "Unnamed: 0.1": 332,
    "Unnamed: 0": 332,
    "time": 1683920400,
    "open": 168.14,
    "high": 168.68,
    "low": 167.64,
    "close": 168.48,
    "volume": 2430461.0
  },
  {
    "Unnamed: 0.1": 333,
    "Unnamed: 0": 333,
    "time": 1683920700,
    "open": 168.48,
    "high": 168.71,
    "low": 167.58,
    "close": 167.58,
    "volume": 1847422.0
  },
  {
    "Unnamed: 0.1": 334,
    "Unnamed: 0": 334,
    "time": 1683921000,
    "open": 167.58,
    "high": 168.09,
    "low": 167.27,
    "close": 167.98,
    "volume": 1640076.0
  },
  {
    "Unnamed: 0.1": 335,
    "Unnamed: 0": 335,
    "time": 1683921300,
    "open": 167.99,
    "high": 168.4,
    "low": 167.91,
    "close": 168.0,
    "volume": 1958117.0
  },
  {
    "Unnamed: 0.1": 336,
    "Unnamed: 0": 336,
    "time": 1683921600,
    "open": 167.98,
    "high": 168.04,
    "low": 167.64,
    "close": 167.67,
    "volume": 1383628.0
  },
  {
    "Unnamed: 0.1": 337,
    "Unnamed: 0": 337,
    "time": 1683921900,
    "open": 167.67,
    "high": 167.98,
    "low": 167.55,
    "close": 167.73,
    "volume": 68975.0
  },
  {
    "Unnamed: 0.1": 338,
    "Unnamed: 0": 338,
    "time": 1683922200,
    "open": 167.73,
    "high": 167.98,
    "low": 167.6,
    "close": 167.7,
    "volume": 20330.0
  },
  {
    "Unnamed: 0.1": 339,
    "Unnamed: 0": 339,
    "time": 1683922500,
    "open": 167.75,
    "high": 167.8,
    "low": 167.7,
    "close": 167.77,
    "volume": 9829.0
  },
  {
    "Unnamed: 0.1": 340,
    "Unnamed: 0": 340,
    "time": 1683922800,
    "open": 167.7,
    "high": 167.75,
    "low": 167.61,
    "close": 167.69,
    "volume": 17203.0
  },
  {
    "Unnamed: 0.1": 341,
    "Unnamed: 0": 341,
    "time": 1683923100,
    "open": 167.66,
    "high": 167.69,
    "low": 167.53,
    "close": 167.56,
    "volume": 22639.0
  },
  {
    "Unnamed: 0.1": 342,
    "Unnamed: 0": 342,
    "time": 1683923400,
    "open": 167.54,
    "high": 167.6,
    "low": 167.53,
    "close": 167.6,
    "volume": 16745.0
  },
  {
    "Unnamed: 0.1": 343,
    "Unnamed: 0": 343,
    "time": 1683923700,
    "open": 167.6,
    "high": 167.98,
    "low": 167.57,
    "close": 167.7,
    "volume": 21102.0
  },
  {
    "Unnamed: 0.1": 344,
    "Unnamed: 0": 344,
    "time": 1683924000,
    "open": 167.68,
    "high": 167.7,
    "low": 167.55,
    "close": 167.6,
    "volume": 19338.0
  },
  {
    "Unnamed: 0.1": 345,
    "Unnamed: 0": 345,
    "time": 1683924300,
    "open": 167.65,
    "high": 167.68,
    "low": 167.58,
    "close": 167.65,
    "volume": 5382.0
  },
  {
    "Unnamed: 0.1": 346,
    "Unnamed: 0": 346,
    "time": 1683924600,
    "open": 167.65,
    "high": 167.67,
    "low": 167.62,
    "close": 167.65,
    "volume": 9621.0
  },
  {
    "Unnamed: 0.1": 347,
    "Unnamed: 0": 347,
    "time": 1683924900,
    "open": 167.64,
    "high": 167.69,
    "low": 167.64,
    "close": 167.66,
    "volume": 6213.0
  },
  {
    "Unnamed: 0.1": 348,
    "Unnamed: 0": 348,
    "time": 1683925200,
    "open": 167.66,
    "high": 167.67,
    "low": 167.66,
    "close": 167.67,
    "volume": 5201.0
  },
  {
    "Unnamed: 0.1": 349,
    "Unnamed: 0": 349,
    "time": 1683925500,
    "open": 167.67,
    "high": 167.67,
    "low": 167.65,
    "close": 167.65,
    "volume": 7536.0
  },
  {
    "Unnamed: 0.1": 350,
    "Unnamed: 0": 350,
    "time": 1683925800,
    "open": 167.67,
    "high": 167.67,
    "low": 167.57,
    "close": 167.61,
    "volume": 16129.0
  },
  {
    "Unnamed: 0.1": 351,
    "Unnamed: 0": 351,
    "time": 1683926100,
    "open": 167.64,
    "high": 167.64,
    "low": 167.56,
    "close": 167.6,
    "volume": 10288.0
  },
  {
    "Unnamed: 0.1": 352,
    "Unnamed: 0": 352,
    "time": 1683926400,
    "open": 167.56,
    "high": 167.57,
    "low": 167.51,
    "close": 167.52,
    "volume": 17094.0
  },
  {
    "Unnamed: 0.1": 353,
    "Unnamed: 0": 353,
    "time": 1683926700,
    "open": 167.56,
    "high": 167.57,
    "low": 167.51,
    "close": 167.54,
    "volume": 7946.0
  },
  {
    "Unnamed: 0.1": 354,
    "Unnamed: 0": 354,
    "time": 1683927000,
    "open": 167.56,
    "high": 167.57,
    "low": 167.53,
    "close": 167.53,
    "volume": 9722.0
  },
  {
    "Unnamed: 0.1": 355,
    "Unnamed: 0": 355,
    "time": 1683927300,
    "open": 167.54,
    "high": 167.55,
    "low": 167.51,
    "close": 167.53,
    "volume": 9917.0
  },
  {
    "Unnamed: 0.1": 356,
    "Unnamed: 0": 356,
    "time": 1683927600,
    "open": 167.55,
    "high": 167.55,
    "low": 167.4,
    "close": 167.43,
    "volume": 24950.0
  },
  {
    "Unnamed: 0.1": 357,
    "Unnamed: 0": 357,
    "time": 1683927900,
    "open": 167.42,
    "high": 167.45,
    "low": 167.12,
    "close": 167.12,
    "volume": 46015.0
  },
  {
    "Unnamed: 0.1": 358,
    "Unnamed: 0": 358,
    "time": 1683928200,
    "open": 167.2,
    "high": 167.22,
    "low": 167.14,
    "close": 167.15,
    "volume": 22577.0
  },
  {
    "Unnamed: 0.1": 359,
    "Unnamed: 0": 359,
    "time": 1683928500,
    "open": 167.2,
    "high": 167.27,
    "low": 167.14,
    "close": 167.27,
    "volume": 14306.0
  },
  {
    "Unnamed: 0.1": 360,
    "Unnamed: 0": 360,
    "time": 1683928800,
    "open": 167.27,
    "high": 167.4,
    "low": 167.22,
    "close": 167.35,
    "volume": 12570.0
  },
  {
    "Unnamed: 0.1": 361,
    "Unnamed: 0": 361,
    "time": 1683929100,
    "open": 167.33,
    "high": 167.37,
    "low": 167.32,
    "close": 167.37,
    "volume": 7413.0
  },
  {
    "Unnamed: 0.1": 362,
    "Unnamed: 0": 362,
    "time": 1683929400,
    "open": 167.39,
    "high": 167.45,
    "low": 167.35,
    "close": 167.37,
    "volume": 7011.0
  },
  {
    "Unnamed: 0.1": 363,
    "Unnamed: 0": 363,
    "time": 1683929700,
    "open": 167.39,
    "high": 167.42,
    "low": 167.36,
    "close": 167.36,
    "volume": 5880.0
  },
  {
    "Unnamed: 0.1": 364,
    "Unnamed: 0": 364,
    "time": 1683930000,
    "open": 167.35,
    "high": 167.39,
    "low": 167.35,
    "close": 167.35,
    "volume": 6222.0
  },
  {
    "Unnamed: 0.1": 365,
    "Unnamed: 0": 365,
    "time": 1683930300,
    "open": 167.35,
    "high": 167.41,
    "low": 167.34,
    "close": 167.4,
    "volume": 5077.0
  },
  {
    "Unnamed: 0.1": 366,
    "Unnamed: 0": 366,
    "time": 1683930600,
    "open": 167.4,
    "high": 167.49,
    "low": 167.39,
    "close": 167.49,
    "volume": 11625.0
  },
  {
    "Unnamed: 0.1": 367,
    "Unnamed: 0": 367,
    "time": 1683930900,
    "open": 167.47,
    "high": 167.49,
    "low": 167.44,
    "close": 167.49,
    "volume": 2686.0
  },
  {
    "Unnamed: 0.1": 368,
    "Unnamed: 0": 368,
    "time": 1683931200,
    "open": 167.5,
    "high": 167.62,
    "low": 167.49,
    "close": 167.56,
    "volume": 9398.0
  },
  {
    "Unnamed: 0.1": 369,
    "Unnamed: 0": 369,
    "time": 1683931500,
    "open": 167.5,
    "high": 167.52,
    "low": 167.45,
    "close": 167.46,
    "volume": 5326.0
  },
  {
    "Unnamed: 0.1": 370,
    "Unnamed: 0": 370,
    "time": 1683931800,
    "open": 167.44,
    "high": 167.51,
    "low": 167.37,
    "close": 167.47,
    "volume": 30682.0
  },
  {
    "Unnamed: 0.1": 371,
    "Unnamed: 0": 371,
    "time": 1683932100,
    "open": 167.44,
    "high": 167.46,
    "low": 167.38,
    "close": 167.38,
    "volume": 6583.0
  },
  {
    "Unnamed: 0.1": 372,
    "Unnamed: 0": 372,
    "time": 1683932400,
    "open": 167.4,
    "high": 167.45,
    "low": 167.35,
    "close": 167.4,
    "volume": 3241.0
  },
  {
    "Unnamed: 0.1": 373,
    "Unnamed: 0": 373,
    "time": 1683932700,
    "open": 167.41,
    "high": 167.41,
    "low": 167.36,
    "close": 167.38,
    "volume": 2715.0
  },
  {
    "Unnamed: 0.1": 374,
    "Unnamed: 0": 374,
    "time": 1683933000,
    "open": 167.39,
    "high": 167.39,
    "low": 167.3,
    "close": 167.35,
    "volume": 5091.0
  },
  {
    "Unnamed: 0.1": 375,
    "Unnamed: 0": 375,
    "time": 1683933300,
    "open": 167.35,
    "high": 167.38,
    "low": 167.31,
    "close": 167.36,
    "volume": 4721.0
  },
  {
    "Unnamed: 0.1": 376,
    "Unnamed: 0": 376,
    "time": 1683933600,
    "open": 167.37,
    "high": 167.4,
    "low": 167.34,
    "close": 167.34,
    "volume": 3462.0
  },
  {
    "Unnamed: 0.1": 377,
    "Unnamed: 0": 377,
    "time": 1683933900,
    "open": 167.36,
    "high": 167.39,
    "low": 167.3,
    "close": 167.35,
    "volume": 8539.0
  },
  {
    "Unnamed: 0.1": 378,
    "Unnamed: 0": 378,
    "time": 1683934200,
    "open": 167.3,
    "high": 167.34,
    "low": 167.3,
    "close": 167.34,
    "volume": 6115.0
  },
  {
    "Unnamed: 0.1": 379,
    "Unnamed: 0": 379,
    "time": 1683934500,
    "open": 167.34,
    "high": 167.36,
    "low": 167.31,
    "close": 167.34,
    "volume": 4896.0
  },
  {
    "Unnamed: 0.1": 380,
    "Unnamed: 0": 380,
    "time": 1683934800,
    "open": 167.36,
    "high": 167.4,
    "low": 167.31,
    "close": 167.39,
    "volume": 16217.0
  },
  {
    "Unnamed: 0.1": 381,
    "Unnamed: 0": 381,
    "time": 1683935100,
    "open": 167.38,
    "high": 167.6,
    "low": 167.38,
    "close": 167.45,
    "volume": 12921.0
  },
  {
    "Unnamed: 0.1": 382,
    "Unnamed: 0": 382,
    "time": 1683935400,
    "open": 167.45,
    "high": 167.47,
    "low": 167.3,
    "close": 167.31,
    "volume": 11331.0
  },
  {
    "Unnamed: 0.1": 383,
    "Unnamed: 0": 383,
    "time": 1683935700,
    "open": 167.31,
    "high": 167.32,
    "low": 167.18,
    "close": 167.2,
    "volume": 26488.0
  },
  {
    "Unnamed: 0.1": 384,
    "Unnamed: 0": 576,
    "time": 1684137600,
    "open": 168.55,
    "high": 169.47,
    "low": 168.35,
    "close": 169.14,
    "volume": 14894.0
  },
  {
    "Unnamed: 0.1": 385,
    "Unnamed: 0": 577,
    "time": 1684137900,
    "open": 169.18,
    "high": 169.7,
    "low": 169.18,
    "close": 169.57,
    "volume": 19063.0
  },
  {
    "Unnamed: 0.1": 386,
    "Unnamed: 0": 578,
    "time": 1684138200,
    "open": 169.6,
    "high": 169.85,
    "low": 169.4,
    "close": 169.85,
    "volume": 5042.0
  },
  {
    "Unnamed: 0.1": 387,
    "Unnamed: 0": 579,
    "time": 1684138500,
    "open": 169.85,
    "high": 169.94,
    "low": 169.75,
    "close": 169.85,
    "volume": 8397.0
  },
  {
    "Unnamed: 0.1": 388,
    "Unnamed: 0": 580,
    "time": 1684138800,
    "open": 169.78,
    "high": 169.78,
    "low": 169.5,
    "close": 169.56,
    "volume": 9994.0
  },
  {
    "Unnamed: 0.1": 389,
    "Unnamed: 0": 581,
    "time": 1684139100,
    "open": 169.56,
    "high": 169.68,
    "low": 169.56,
    "close": 169.64,
    "volume": 2573.0
  },
  {
    "Unnamed: 0.1": 390,
    "Unnamed: 0": 582,
    "time": 1684139400,
    "open": 169.65,
    "high": 169.72,
    "low": 169.65,
    "close": 169.72,
    "volume": 1102.0
  },
  {
    "Unnamed: 0.1": 391,
    "Unnamed: 0": 583,
    "time": 1684139700,
    "open": 169.79,
    "high": 169.8,
    "low": 169.6,
    "close": 169.6,
    "volume": 1134.0
  },
  {
    "Unnamed: 0.1": 392,
    "Unnamed: 0": 584,
    "time": 1684140000,
    "open": 169.6,
    "high": 169.63,
    "low": 169.6,
    "close": 169.62,
    "volume": 977.0
  },
  {
    "Unnamed: 0.1": 393,
    "Unnamed: 0": 585,
    "time": 1684140300,
    "open": 169.69,
    "high": 169.72,
    "low": 169.4,
    "close": 169.4,
    "volume": 3290.0
  },
  {
    "Unnamed: 0.1": 394,
    "Unnamed: 0": 586,
    "time": 1684140600,
    "open": 169.41,
    "high": 169.51,
    "low": 169.21,
    "close": 169.21,
    "volume": 4425.0
  },
  {
    "Unnamed: 0.1": 395,
    "Unnamed: 0": 587,
    "time": 1684140900,
    "open": 169.21,
    "high": 169.21,
    "low": 168.8,
    "close": 168.8,
    "volume": 9217.0
  },
  {
    "Unnamed: 0.1": 396,
    "Unnamed: 0": 588,
    "time": 1684141200,
    "open": 168.81,
    "high": 169.13,
    "low": 168.8,
    "close": 169.1,
    "volume": 5884.0
  },
  {
    "Unnamed: 0.1": 397,
    "Unnamed: 0": 589,
    "time": 1684141500,
    "open": 169.04,
    "high": 169.1,
    "low": 168.92,
    "close": 168.92,
    "volume": 1532.0
  },
  {
    "Unnamed: 0.1": 398,
    "Unnamed: 0": 590,
    "time": 1684141800,
    "open": 169.01,
    "high": 169.01,
    "low": 168.99,
    "close": 168.99,
    "volume": 686.0
  },
  {
    "Unnamed: 0.1": 399,
    "Unnamed: 0": 591,
    "time": 1684142100,
    "open": 169.0,
    "high": 169.19,
    "low": 169.0,
    "close": 169.15,
    "volume": 822.0
  },
  {
    "Unnamed: 0.1": 400,
    "Unnamed: 0": 592,
    "time": 1684142400,
    "open": 169.23,
    "high": 169.23,
    "low": 168.9,
    "close": 169.02,
    "volume": 1802.0
  },
  {
    "Unnamed: 0.1": 401,
    "Unnamed: 0": 593,
    "time": 1684142700,
    "open": 168.91,
    "high": 169.0,
    "low": 168.81,
    "close": 168.91,
    "volume": 2865.0
  },
  {
    "Unnamed: 0.1": 402,
    "Unnamed: 0": 594,
    "time": 1684143000,
    "open": 169.0,
    "high": 169.2,
    "low": 169.0,
    "close": 169.12,
    "volume": 4174.0
  },
  {
    "Unnamed: 0.1": 403,
    "Unnamed: 0": 595,
    "time": 1684143300,
    "open": 169.15,
    "high": 169.15,
    "low": 168.85,
    "close": 168.93,
    "volume": 1744.0
  },
  {
    "Unnamed: 0.1": 404,
    "Unnamed: 0": 596,
    "time": 1684143600,
    "open": 168.9,
    "high": 168.97,
    "low": 168.8,
    "close": 168.91,
    "volume": 2504.0
  },
  {
    "Unnamed: 0.1": 405,
    "Unnamed: 0": 597,
    "time": 1684143900,
    "open": 168.9,
    "high": 168.9,
    "low": 168.85,
    "close": 168.85,
    "volume": 1020.0
  },
  {
    "Unnamed: 0.1": 406,
    "Unnamed: 0": 598,
    "time": 1684144200,
    "open": 168.9,
    "high": 168.98,
    "low": 168.9,
    "close": 168.98,
    "volume": 1170.0
  },
  {
    "Unnamed: 0.1": 407,
    "Unnamed: 0": 599,
    "time": 1684144500,
    "open": 168.94,
    "high": 168.95,
    "low": 168.94,
    "close": 168.95,
    "volume": 312.0
  },
  {
    "Unnamed: 0.1": 408,
    "Unnamed: 0": 600,
    "time": 1684144800,
    "open": 168.95,
    "high": 169.3,
    "low": 168.95,
    "close": 169.3,
    "volume": 5916.0
  },
  {
    "Unnamed: 0.1": 409,
    "Unnamed: 0": 601,
    "time": 1684145100,
    "open": 169.12,
    "high": 169.12,
    "low": 168.6,
    "close": 168.6,
    "volume": 12974.0
  },
  {
    "Unnamed: 0.1": 410,
    "Unnamed: 0": 602,
    "time": 1684145400,
    "open": 168.62,
    "high": 168.62,
    "low": 168.62,
    "close": 168.62,
    "volume": 135.0
  },
  {
    "Unnamed: 0.1": 411,
    "Unnamed: 0": 603,
    "time": 1684145700,
    "open": 168.85,
    "high": 168.85,
    "low": 168.85,
    "close": 168.85,
    "volume": 1893.0
  },
  {
    "Unnamed: 0.1": 412,
    "Unnamed: 0": 604,
    "time": 1684146000,
    "open": 168.76,
    "high": 168.96,
    "low": 168.76,
    "close": 168.94,
    "volume": 1437.0
  },
  {
    "Unnamed: 0.1": 413,
    "Unnamed: 0": 605,
    "time": 1684146300,
    "open": 168.9,
    "high": 168.9,
    "low": 168.83,
    "close": 168.83,
    "volume": 382.0
  },
  {
    "Unnamed: 0.1": 414,
    "Unnamed: 0": 606,
    "time": 1684146600,
    "open": 168.77,
    "high": 168.86,
    "low": 168.76,
    "close": 168.8,
    "volume": 450.0
  },
  {
    "Unnamed: 0.1": 415,
    "Unnamed: 0": 607,
    "time": 1684146900,
    "open": 168.78,
    "high": 168.87,
    "low": 168.78,
    "close": 168.87,
    "volume": 576.0
  },
  {
    "Unnamed: 0.1": 416,
    "Unnamed: 0": 608,
    "time": 1684147200,
    "open": 168.87,
    "high": 169.19,
    "low": 168.87,
    "close": 169.14,
    "volume": 6994.0
  },
  {
    "Unnamed: 0.1": 417,
    "Unnamed: 0": 609,
    "time": 1684147500,
    "open": 169.19,
    "high": 169.3,
    "low": 169.18,
    "close": 169.18,
    "volume": 1629.0
  },
  {
    "Unnamed: 0.1": 418,
    "Unnamed: 0": 610,
    "time": 1684147800,
    "open": 169.09,
    "high": 169.09,
    "low": 168.78,
    "close": 168.82,
    "volume": 5380.0
  },
  {
    "Unnamed: 0.1": 419,
    "Unnamed: 0": 611,
    "time": 1684148100,
    "open": 168.74,
    "high": 168.74,
    "low": 168.6,
    "close": 168.65,
    "volume": 5249.0
  },
  {
    "Unnamed: 0.1": 420,
    "Unnamed: 0": 612,
    "time": 1684148400,
    "open": 168.65,
    "high": 168.67,
    "low": 167.88,
    "close": 167.89,
    "volume": 34742.0
  },
  {
    "Unnamed: 0.1": 421,
    "Unnamed: 0": 613,
    "time": 1684148700,
    "open": 167.9,
    "high": 167.93,
    "low": 167.65,
    "close": 167.65,
    "volume": 26349.0
  },
  {
    "Unnamed: 0.1": 422,
    "Unnamed: 0": 614,
    "time": 1684149000,
    "open": 167.64,
    "high": 167.75,
    "low": 167.57,
    "close": 167.65,
    "volume": 25617.0
  },
  {
    "Unnamed: 0.1": 423,
    "Unnamed: 0": 615,
    "time": 1684149300,
    "open": 167.66,
    "high": 168.08,
    "low": 167.66,
    "close": 167.95,
    "volume": 26851.0
  },
  {
    "Unnamed: 0.1": 424,
    "Unnamed: 0": 616,
    "time": 1684149600,
    "open": 167.9,
    "high": 168.0,
    "low": 167.89,
    "close": 167.95,
    "volume": 9000.0
  },
  {
    "Unnamed: 0.1": 425,
    "Unnamed: 0": 617,
    "time": 1684149900,
    "open": 167.98,
    "high": 167.99,
    "low": 167.8,
    "close": 167.85,
    "volume": 14136.0
  },
  {
    "Unnamed: 0.1": 426,
    "Unnamed: 0": 618,
    "time": 1684150200,
    "open": 167.87,
    "high": 167.96,
    "low": 167.62,
    "close": 167.65,
    "volume": 19490.0
  },
  {
    "Unnamed: 0.1": 427,
    "Unnamed: 0": 619,
    "time": 1684150500,
    "open": 167.65,
    "high": 168.2,
    "low": 167.58,
    "close": 168.0,
    "volume": 24792.0
  },
  {
    "Unnamed: 0.1": 428,
    "Unnamed: 0": 620,
    "time": 1684150800,
    "open": 168.0,
    "high": 168.04,
    "low": 167.9,
    "close": 167.9,
    "volume": 4999.0
  },
  {
    "Unnamed: 0.1": 429,
    "Unnamed: 0": 621,
    "time": 1684151100,
    "open": 167.9,
    "high": 167.95,
    "low": 167.7,
    "close": 167.81,
    "volume": 8122.0
  },
  {
    "Unnamed: 0.1": 430,
    "Unnamed: 0": 622,
    "time": 1684151400,
    "open": 167.88,
    "high": 167.9,
    "low": 167.78,
    "close": 167.89,
    "volume": 4340.0
  },
  {
    "Unnamed: 0.1": 431,
    "Unnamed: 0": 623,
    "time": 1684151700,
    "open": 167.94,
    "high": 168.16,
    "low": 167.94,
    "close": 168.06,
    "volume": 10300.0
  },
  {
    "Unnamed: 0.1": 432,
    "Unnamed: 0": 624,
    "time": 1684152000,
    "open": 168.63,
    "high": 169.02,
    "low": 167.55,
    "close": 168.12,
    "volume": 199353.0
  },
  {
    "Unnamed: 0.1": 433,
    "Unnamed: 0": 625,
    "time": 1684152300,
    "open": 168.08,
    "high": 168.12,
    "low": 167.9,
    "close": 168.07,
    "volume": 21413.0
  },
  {
    "Unnamed: 0.1": 434,
    "Unnamed: 0": 626,
    "time": 1684152600,
    "open": 168.07,
    "high": 168.08,
    "low": 167.98,
    "close": 167.98,
    "volume": 18746.0
  },
  {
    "Unnamed: 0.1": 435,
    "Unnamed: 0": 627,
    "time": 1684152900,
    "open": 168.0,
    "high": 168.03,
    "low": 167.96,
    "close": 168.01,
    "volume": 12110.0
  },
  {
    "Unnamed: 0.1": 436,
    "Unnamed: 0": 628,
    "time": 1684153200,
    "open": 167.99,
    "high": 167.99,
    "low": 167.65,
    "close": 167.75,
    "volume": 16797.0
  },
  {
    "Unnamed: 0.1": 437,
    "Unnamed: 0": 629,
    "time": 1684153500,
    "open": 167.75,
    "high": 167.8,
    "low": 167.21,
    "close": 167.32,
    "volume": 61951.0
  },
  {
    "Unnamed: 0.1": 438,
    "Unnamed: 0": 630,
    "time": 1684153800,
    "open": 167.39,
    "high": 167.72,
    "low": 167.22,
    "close": 167.5,
    "volume": 41195.0
  },
  {
    "Unnamed: 0.1": 439,
    "Unnamed: 0": 631,
    "time": 1684154100,
    "open": 167.4,
    "high": 167.58,
    "low": 167.25,
    "close": 167.31,
    "volume": 22889.0
  },
  {
    "Unnamed: 0.1": 440,
    "Unnamed: 0": 632,
    "time": 1684154400,
    "open": 167.32,
    "high": 167.46,
    "low": 167.3,
    "close": 167.35,
    "volume": 15541.0
  },
  {
    "Unnamed: 0.1": 441,
    "Unnamed: 0": 633,
    "time": 1684154700,
    "open": 167.3,
    "high": 167.98,
    "low": 167.3,
    "close": 167.78,
    "volume": 51130.0
  },
  {
    "Unnamed: 0.1": 442,
    "Unnamed: 0": 634,
    "time": 1684155000,
    "open": 167.7,
    "high": 168.08,
    "low": 167.63,
    "close": 167.74,
    "volume": 50172.0
  },
  {
    "Unnamed: 0.1": 443,
    "Unnamed: 0": 635,
    "time": 1684155300,
    "open": 167.66,
    "high": 167.67,
    "low": 167.31,
    "close": 167.41,
    "volume": 32985.0
  },
  {
    "Unnamed: 0.1": 444,
    "Unnamed: 0": 636,
    "time": 1684155600,
    "open": 167.4,
    "high": 167.6,
    "low": 167.32,
    "close": 167.41,
    "volume": 36604.0
  },
  {
    "Unnamed: 0.1": 445,
    "Unnamed: 0": 637,
    "time": 1684155900,
    "open": 167.41,
    "high": 167.55,
    "low": 167.38,
    "close": 167.48,
    "volume": 16898.0
  },
  {
    "Unnamed: 0.1": 446,
    "Unnamed: 0": 638,
    "time": 1684156200,
    "open": 167.48,
    "high": 168.05,
    "low": 167.42,
    "close": 167.78,
    "volume": 54362.0
  },
  {
    "Unnamed: 0.1": 447,
    "Unnamed: 0": 639,
    "time": 1684156500,
    "open": 167.77,
    "high": 168.2,
    "low": 167.75,
    "close": 168.03,
    "volume": 68398.0
  },
  {
    "Unnamed: 0.1": 448,
    "Unnamed: 0": 640,
    "time": 1684156800,
    "open": 168.0,
    "high": 168.0,
    "low": 167.7,
    "close": 167.85,
    "volume": 26372.0
  },
  {
    "Unnamed: 0.1": 449,
    "Unnamed: 0": 641,
    "time": 1684157100,
    "open": 167.9,
    "high": 167.9,
    "low": 167.51,
    "close": 167.71,
    "volume": 34958.0
  },
  {
    "Unnamed: 0.1": 450,
    "Unnamed: 0": 642,
    "time": 1684157400,
    "open": 167.66,
    "high": 168.88,
    "low": 166.73,
    "close": 168.72,
    "volume": 3387606.0
  },
  {
    "Unnamed: 0.1": 451,
    "Unnamed: 0": 643,
    "time": 1684157700,
    "open": 168.75,
    "high": 169.16,
    "low": 168.29,
    "close": 168.47,
    "volume": 2130684.0
  },
  {
    "Unnamed: 0.1": 452,
    "Unnamed: 0": 644,
    "time": 1684158000,
    "open": 168.48,
    "high": 169.7,
    "low": 168.2,
    "close": 169.51,
    "volume": 2501179.0
  },
  {
    "Unnamed: 0.1": 453,
    "Unnamed: 0": 645,
    "time": 1684158300,
    "open": 169.5,
    "high": 169.76,
    "low": 168.73,
    "close": 168.95,
    "volume": 1577449.0
  },
  {
    "Unnamed: 0.1": 454,
    "Unnamed: 0": 646,
    "time": 1684158600,
    "open": 168.93,
    "high": 169.06,
    "low": 167.19,
    "close": 167.4,
    "volume": 2768244.0
  },
  {
    "Unnamed: 0.1": 455,
    "Unnamed: 0": 647,
    "time": 1684158900,
    "open": 167.39,
    "high": 167.63,
    "low": 165.18,
    "close": 165.29,
    "volume": 3681801.0
  },
  {
    "Unnamed: 0.1": 456,
    "Unnamed: 0": 648,
    "time": 1684159200,
    "open": 165.3,
    "high": 166.38,
    "low": 165.28,
    "close": 166.28,
    "volume": 2367084.0
  },
  {
    "Unnamed: 0.1": 457,
    "Unnamed: 0": 649,
    "time": 1684159500,
    "open": 166.3,
    "high": 166.44,
    "low": 165.15,
    "close": 165.69,
    "volume": 2049596.0
  },
  {
    "Unnamed: 0.1": 458,
    "Unnamed: 0": 650,
    "time": 1684159800,
    "open": 165.69,
    "high": 166.2,
    "low": 165.68,
    "close": 165.93,
    "volume": 1221905.0
  },
  {
    "Unnamed: 0.1": 459,
    "Unnamed: 0": 651,
    "time": 1684160100,
    "open": 165.92,
    "high": 166.3,
    "low": 165.8,
    "close": 166.12,
    "volume": 1504563.0
  },
  {
    "Unnamed: 0.1": 460,
    "Unnamed: 0": 652,
    "time": 1684160400,
    "open": 166.11,
    "high": 166.66,
    "low": 165.51,
    "close": 166.41,
    "volume": 1868444.0
  },
  {
    "Unnamed: 0.1": 461,
    "Unnamed: 0": 653,
    "time": 1684160700,
    "open": 166.42,
    "high": 166.56,
    "low": 166.09,
    "close": 166.26,
    "volume": 949515.0
  },
  {
    "Unnamed: 0.1": 462,
    "Unnamed: 0": 654,
    "time": 1684161000,
    "open": 166.25,
    "high": 166.78,
    "low": 165.94,
    "close": 166.5,
    "volume": 1427052.0
  },
  {
    "Unnamed: 0.1": 463,
    "Unnamed: 0": 655,
    "time": 1684161300,
    "open": 166.5,
    "high": 166.89,
    "low": 166.33,
    "close": 166.65,
    "volume": 1019919.0
  },
  {
    "Unnamed: 0.1": 464,
    "Unnamed: 0": 656,
    "time": 1684161600,
    "open": 166.65,
    "high": 166.77,
    "low": 166.3,
    "close": 166.36,
    "volume": 928466.0
  },
  {
    "Unnamed: 0.1": 465,
    "Unnamed: 0": 657,
    "time": 1684161900,
    "open": 166.37,
    "high": 166.38,
    "low": 165.56,
    "close": 165.89,
    "volume": 1485321.0
  },
  {
    "Unnamed: 0.1": 466,
    "Unnamed: 0": 658,
    "time": 1684162200,
    "open": 165.89,
    "high": 166.44,
    "low": 165.81,
    "close": 166.19,
    "volume": 1074468.0
  },
  {
    "Unnamed: 0.1": 467,
    "Unnamed: 0": 659,
    "time": 1684162500,
    "open": 166.18,
    "high": 166.29,
    "low": 164.54,
    "close": 164.75,
    "volume": 2153552.0
  },
  {
    "Unnamed: 0.1": 468,
    "Unnamed: 0": 660,
    "time": 1684162800,
    "open": 164.74,
    "high": 165.27,
    "low": 164.64,
    "close": 165.08,
    "volume": 1283462.0
  },
  {
    "Unnamed: 0.1": 469,
    "Unnamed: 0": 661,
    "time": 1684163100,
    "open": 165.12,
    "high": 166.0,
    "low": 165.11,
    "close": 165.87,
    "volume": 1268084.0
  },
  {
    "Unnamed: 0.1": 470,
    "Unnamed: 0": 662,
    "time": 1684163400,
    "open": 165.86,
    "high": 166.13,
    "low": 165.64,
    "close": 165.67,
    "volume": 1236398.0
  },
  {
    "Unnamed: 0.1": 471,
    "Unnamed: 0": 663,
    "time": 1684163700,
    "open": 165.66,
    "high": 166.24,
    "low": 165.48,
    "close": 166.14,
    "volume": 1166143.0
  },
  {
    "Unnamed: 0.1": 472,
    "Unnamed: 0": 664,
    "time": 1684164000,
    "open": 166.14,
    "high": 166.29,
    "low": 165.96,
    "close": 166.06,
    "volume": 899192.0
  },
  {
    "Unnamed: 0.1": 473,
    "Unnamed: 0": 665,
    "time": 1684164300,
    "open": 166.05,
    "high": 166.21,
    "low": 165.61,
    "close": 165.95,
    "volume": 1175592.0
  },
  {
    "Unnamed: 0.1": 474,
    "Unnamed: 0": 666,
    "time": 1684164600,
    "open": 165.95,
    "high": 166.19,
    "low": 165.78,
    "close": 166.16,
    "volume": 1291821.0
  },
  {
    "Unnamed: 0.1": 475,
    "Unnamed: 0": 667,
    "time": 1684164900,
    "open": 166.16,
    "high": 166.71,
    "low": 166.16,
    "close": 166.54,
    "volume": 1362800.0
  },
  {
    "Unnamed: 0.1": 476,
    "Unnamed: 0": 668,
    "time": 1684165200,
    "open": 166.55,
    "high": 166.86,
    "low": 166.31,
    "close": 166.55,
    "volume": 1136602.0
  },
  {
    "Unnamed: 0.1": 477,
    "Unnamed: 0": 669,
    "time": 1684165500,
    "open": 166.55,
    "high": 167.37,
    "low": 166.22,
    "close": 167.34,
    "volume": 1566593.0
  },
  {
    "Unnamed: 0.1": 478,
    "Unnamed: 0": 670,
    "time": 1684165800,
    "open": 167.34,
    "high": 167.57,
    "low": 167.2,
    "close": 167.32,
    "volume": 1249141.0
  },
  {
    "Unnamed: 0.1": 479,
    "Unnamed: 0": 671,
    "time": 1684166100,
    "open": 167.33,
    "high": 167.92,
    "low": 167.32,
    "close": 167.84,
    "volume": 1172040.0
  },
  {
    "Unnamed: 0.1": 480,
    "Unnamed: 0": 672,
    "time": 1684166400,
    "open": 167.84,
    "high": 168.01,
    "low": 167.55,
    "close": 167.71,
    "volume": 1127677.0
  },
  {
    "Unnamed: 0.1": 481,
    "Unnamed: 0": 673,
    "time": 1684166700,
    "open": 167.69,
    "high": 167.75,
    "low": 167.47,
    "close": 167.55,
    "volume": 686863.0
  },
  {
    "Unnamed: 0.1": 482,
    "Unnamed: 0": 674,
    "time": 1684167000,
    "open": 167.54,
    "high": 168.0,
    "low": 167.52,
    "close": 167.73,
    "volume": 942411.0
  },
  {
    "Unnamed: 0.1": 483,
    "Unnamed: 0": 675,
    "time": 1684167300,
    "open": 167.72,
    "high": 167.86,
    "low": 167.45,
    "close": 167.77,
    "volume": 884251.0
  },
  {
    "Unnamed: 0.1": 484,
    "Unnamed: 0": 676,
    "time": 1684167600,
    "open": 167.75,
    "high": 167.77,
    "low": 167.55,
    "close": 167.67,
    "volume": 516410.0
  },
  {
    "Unnamed: 0.1": 485,
    "Unnamed: 0": 677,
    "time": 1684167900,
    "open": 167.66,
    "high": 167.72,
    "low": 167.21,
    "close": 167.65,
    "volume": 1043329.0
  },
  {
    "Unnamed: 0.1": 486,
    "Unnamed: 0": 678,
    "time": 1684168200,
    "open": 167.65,
    "high": 167.71,
    "low": 167.25,
    "close": 167.33,
    "volume": 700028.0
  },
  {
    "Unnamed: 0.1": 487,
    "Unnamed: 0": 679,
    "time": 1684168500,
    "open": 167.33,
    "high": 167.79,
    "low": 167.31,
    "close": 167.68,
    "volume": 860425.0
  },
  {
    "Unnamed: 0.1": 488,
    "Unnamed: 0": 680,
    "time": 1684168800,
    "open": 167.68,
    "high": 167.92,
    "low": 167.61,
    "close": 167.75,
    "volume": 618436.0
  },
  {
    "Unnamed: 0.1": 489,
    "Unnamed: 0": 681,
    "time": 1684169100,
    "open": 167.73,
    "high": 167.98,
    "low": 167.65,
    "close": 167.66,
    "volume": 757418.0
  },
  {
    "Unnamed: 0.1": 490,
    "Unnamed: 0": 682,
    "time": 1684169400,
    "open": 167.68,
    "high": 168.18,
    "low": 167.57,
    "close": 168.11,
    "volume": 957672.0
  },
  {
    "Unnamed: 0.1": 491,
    "Unnamed: 0": 683,
    "time": 1684169700,
    "open": 168.11,
    "high": 168.24,
    "low": 167.9,
    "close": 168.2,
    "volume": 655477.0
  },
  {
    "Unnamed: 0.1": 492,
    "Unnamed: 0": 684,
    "time": 1684170000,
    "open": 168.2,
    "high": 168.33,
    "low": 168.05,
    "close": 168.17,
    "volume": 722657.0
  },
  {
    "Unnamed: 0.1": 493,
    "Unnamed: 0": 685,
    "time": 1684170300,
    "open": 168.16,
    "high": 168.31,
    "low": 167.97,
    "close": 168.2,
    "volume": 601287.0
  },
  {
    "Unnamed: 0.1": 494,
    "Unnamed: 0": 686,
    "time": 1684170600,
    "open": 168.2,
    "high": 168.29,
    "low": 167.73,
    "close": 167.96,
    "volume": 736926.0
  },
  {
    "Unnamed: 0.1": 495,
    "Unnamed: 0": 687,
    "time": 1684170900,
    "open": 167.95,
    "high": 168.43,
    "low": 167.89,
    "close": 168.28,
    "volume": 1005906.0
  },
  {
    "Unnamed: 0.1": 496,
    "Unnamed: 0": 688,
    "time": 1684171200,
    "open": 168.28,
    "high": 168.39,
    "low": 168.06,
    "close": 168.25,
    "volume": 819222.0
  },
  {
    "Unnamed: 0.1": 497,
    "Unnamed: 0": 689,
    "time": 1684171500,
    "open": 168.27,
    "high": 168.36,
    "low": 168.0,
    "close": 168.07,
    "volume": 751188.0
  },
  {
    "Unnamed: 0.1": 498,
    "Unnamed: 0": 690,
    "time": 1684171800,
    "open": 168.08,
    "high": 168.13,
    "low": 167.36,
    "close": 167.39,
    "volume": 1377287.0
  },
  {
    "Unnamed: 0.1": 499,
    "Unnamed: 0": 691,
    "time": 1684172100,
    "open": 167.41,
    "high": 167.43,
    "low": 167.08,
    "close": 167.15,
    "volume": 862311.0
  },
  {
    "Unnamed: 0.1": 500,
    "Unnamed: 0": 692,
    "time": 1684172400,
    "open": 167.15,
    "high": 167.43,
    "low": 167.04,
    "close": 167.42,
    "volume": 962256.0
  },
  {
    "Unnamed: 0.1": 501,
    "Unnamed: 0": 693,
    "time": 1684172700,
    "open": 167.4,
    "high": 167.42,
    "low": 167.2,
    "close": 167.33,
    "volume": 602943.0
  },
  {
    "Unnamed: 0.1": 502,
    "Unnamed: 0": 694,
    "time": 1684173000,
    "open": 167.33,
    "high": 167.45,
    "low": 167.22,
    "close": 167.39,
    "volume": 714299.0
  },
  {
    "Unnamed: 0.1": 503,
    "Unnamed: 0": 695,
    "time": 1684173300,
    "open": 167.36,
    "high": 167.48,
    "low": 167.28,
    "close": 167.38,
    "volume": 572584.0
  },
  {
    "Unnamed: 0.1": 504,
    "Unnamed: 0": 696,
    "time": 1684173600,
    "open": 167.38,
    "high": 167.44,
    "low": 167.13,
    "close": 167.25,
    "volume": 579901.0
  },
  {
    "Unnamed: 0.1": 505,
    "Unnamed: 0": 697,
    "time": 1684173900,
    "open": 167.27,
    "high": 167.54,
    "low": 167.24,
    "close": 167.38,
    "volume": 717711.0
  },
  {
    "Unnamed: 0.1": 506,
    "Unnamed: 0": 698,
    "time": 1684174200,
    "open": 167.36,
    "high": 167.4,
    "low": 166.92,
    "close": 167.28,
    "volume": 964376.0
  },
  {
    "Unnamed: 0.1": 507,
    "Unnamed: 0": 699,
    "time": 1684174500,
    "open": 167.29,
    "high": 167.34,
    "low": 166.99,
    "close": 167.22,
    "volume": 678842.0
  },
  {
    "Unnamed: 0.1": 508,
    "Unnamed: 0": 700,
    "time": 1684174800,
    "open": 167.22,
    "high": 167.43,
    "low": 167.15,
    "close": 167.4,
    "volume": 474576.0
  },
  {
    "Unnamed: 0.1": 509,
    "Unnamed: 0": 701,
    "time": 1684175100,
    "open": 167.4,
    "high": 167.55,
    "low": 167.25,
    "close": 167.42,
    "volume": 787219.0
  },
  {
    "Unnamed: 0.1": 510,
    "Unnamed: 0": 702,
    "time": 1684175400,
    "open": 167.42,
    "high": 167.49,
    "low": 166.81,
    "close": 166.95,
    "volume": 845826.0
  },
  {
    "Unnamed: 0.1": 511,
    "Unnamed: 0": 703,
    "time": 1684175700,
    "open": 166.94,
    "high": 167.06,
    "low": 166.8,
    "close": 167.0,
    "volume": 522465.0
  },
  {
    "Unnamed: 0.1": 512,
    "Unnamed: 0": 704,
    "time": 1684176000,
    "open": 166.99,
    "high": 167.12,
    "low": 166.9,
    "close": 167.01,
    "volume": 473446.0
  },
  {
    "Unnamed: 0.1": 513,
    "Unnamed: 0": 705,
    "time": 1684176300,
    "open": 167.01,
    "high": 167.12,
    "low": 166.57,
    "close": 166.75,
    "volume": 963786.0
  },
  {
    "Unnamed: 0.1": 514,
    "Unnamed: 0": 706,
    "time": 1684176600,
    "open": 166.75,
    "high": 166.85,
    "low": 166.4,
    "close": 166.49,
    "volume": 929964.0
  },
  {
    "Unnamed: 0.1": 515,
    "Unnamed: 0": 707,
    "time": 1684176900,
    "open": 166.49,
    "high": 166.8,
    "low": 166.44,
    "close": 166.66,
    "volume": 767065.0
  },
  {
    "Unnamed: 0.1": 516,
    "Unnamed: 0": 708,
    "time": 1684177200,
    "open": 166.67,
    "high": 166.67,
    "low": 166.32,
    "close": 166.52,
    "volume": 808386.0
  },
  {
    "Unnamed: 0.1": 517,
    "Unnamed: 0": 709,
    "time": 1684177500,
    "open": 166.49,
    "high": 166.55,
    "low": 166.19,
    "close": 166.24,
    "volume": 687847.0
  },
  {
    "Unnamed: 0.1": 518,
    "Unnamed: 0": 710,
    "time": 1684177800,
    "open": 166.23,
    "high": 166.42,
    "low": 165.9,
    "close": 166.05,
    "volume": 950602.0
  },
  {
    "Unnamed: 0.1": 519,
    "Unnamed: 0": 711,
    "time": 1684178100,
    "open": 166.04,
    "high": 166.26,
    "low": 165.99,
    "close": 166.17,
    "volume": 755931.0
  },
  {
    "Unnamed: 0.1": 520,
    "Unnamed: 0": 712,
    "time": 1684178400,
    "open": 166.19,
    "high": 166.33,
    "low": 165.96,
    "close": 166.15,
    "volume": 863212.0
  },
  {
    "Unnamed: 0.1": 521,
    "Unnamed: 0": 713,
    "time": 1684178700,
    "open": 166.15,
    "high": 166.15,
    "low": 165.81,
    "close": 166.09,
    "volume": 1000869.0
  },
  {
    "Unnamed: 0.1": 522,
    "Unnamed: 0": 714,
    "time": 1684179000,
    "open": 166.09,
    "high": 166.28,
    "low": 165.96,
    "close": 166.08,
    "volume": 897147.0
  },
  {
    "Unnamed: 0.1": 523,
    "Unnamed: 0": 715,
    "time": 1684179300,
    "open": 166.05,
    "high": 166.05,
    "low": 165.72,
    "close": 165.94,
    "volume": 910537.0
  },
  {
    "Unnamed: 0.1": 524,
    "Unnamed: 0": 716,
    "time": 1684179600,
    "open": 165.94,
    "high": 165.94,
    "low": 165.65,
    "close": 165.66,
    "volume": 840995.0
  },
  {
    "Unnamed: 0.1": 525,
    "Unnamed: 0": 717,
    "time": 1684179900,
    "open": 165.66,
    "high": 166.06,
    "low": 165.65,
    "close": 165.98,
    "volume": 975696.0
  },
  {
    "Unnamed: 0.1": 526,
    "Unnamed: 0": 718,
    "time": 1684180200,
    "open": 165.96,
    "high": 166.38,
    "low": 165.93,
    "close": 166.34,
    "volume": 1072705.0
  },
  {
    "Unnamed: 0.1": 527,
    "Unnamed: 0": 719,
    "time": 1684180500,
    "open": 166.34,
    "high": 166.54,
    "low": 166.16,
    "close": 166.36,
    "volume": 1446841.0
  },
  {
    "Unnamed: 0.1": 528,
    "Unnamed: 0": 720,
    "time": 1684180800,
    "open": 166.35,
    "high": 166.48,
    "low": 166.26,
    "close": 166.3,
    "volume": 1334123.0
  },
  {
    "Unnamed: 0.1": 529,
    "Unnamed: 0": 721,
    "time": 1684181100,
    "open": 166.3,
    "high": 166.4,
    "low": 166.26,
    "close": 166.35,
    "volume": 36634.0
  },
  {
    "Unnamed: 0.1": 530,
    "Unnamed: 0": 722,
    "time": 1684181400,
    "open": 166.35,
    "high": 166.39,
    "low": 166.2,
    "close": 166.3,
    "volume": 27455.0
  },
  {
    "Unnamed: 0.1": 531,
    "Unnamed: 0": 723,
    "time": 1684181700,
    "open": 166.28,
    "high": 166.3,
    "low": 166.19,
    "close": 166.27,
    "volume": 19654.0
  },
  {
    "Unnamed: 0.1": 532,
    "Unnamed: 0": 724,
    "time": 1684182000,
    "open": 166.26,
    "high": 166.28,
    "low": 166.15,
    "close": 166.21,
    "volume": 14844.0
  },
  {
    "Unnamed: 0.1": 533,
    "Unnamed: 0": 725,
    "time": 1684182300,
    "open": 166.26,
    "high": 166.26,
    "low": 166.18,
    "close": 166.19,
    "volume": 6157.0
  },
  {
    "Unnamed: 0.1": 534,
    "Unnamed: 0": 726,
    "time": 1684182600,
    "open": 166.2,
    "high": 166.3,
    "low": 166.19,
    "close": 166.3,
    "volume": 8026.0
  },
  {
    "Unnamed: 0.1": 535,
    "Unnamed: 0": 727,
    "time": 1684182900,
    "open": 166.3,
    "high": 166.35,
    "low": 166.27,
    "close": 166.32,
    "volume": 13261.0
  },
  {
    "Unnamed: 0.1": 536,
    "Unnamed: 0": 728,
    "time": 1684183200,
    "open": 166.31,
    "high": 166.38,
    "low": 166.17,
    "close": 166.36,
    "volume": 17453.0
  },
  {
    "Unnamed: 0.1": 537,
    "Unnamed: 0": 729,
    "time": 1684183500,
    "open": 166.35,
    "high": 166.35,
    "low": 165.5,
    "close": 166.08,
    "volume": 72406.0
  },
  {
    "Unnamed: 0.1": 538,
    "Unnamed: 0": 730,
    "time": 1684183800,
    "open": 166.01,
    "high": 166.15,
    "low": 165.88,
    "close": 165.88,
    "volume": 31999.0
  },
  {
    "Unnamed: 0.1": 539,
    "Unnamed: 0": 731,
    "time": 1684184100,
    "open": 165.88,
    "high": 166.0,
    "low": 165.8,
    "close": 165.83,
    "volume": 33362.0
  },
  {
    "Unnamed: 0.1": 540,
    "Unnamed: 0": 732,
    "time": 1684184400,
    "open": 165.85,
    "high": 165.99,
    "low": 165.8,
    "close": 165.85,
    "volume": 21825.0
  },
  {
    "Unnamed: 0.1": 541,
    "Unnamed: 0": 733,
    "time": 1684184700,
    "open": 165.88,
    "high": 166.02,
    "low": 165.85,
    "close": 165.99,
    "volume": 22358.0
  },
  {
    "Unnamed: 0.1": 542,
    "Unnamed: 0": 734,
    "time": 1684185000,
    "open": 166.05,
    "high": 166.14,
    "low": 166.03,
    "close": 166.07,
    "volume": 18432.0
  },
  {
    "Unnamed: 0.1": 543,
    "Unnamed: 0": 735,
    "time": 1684185300,
    "open": 166.09,
    "high": 166.11,
    "low": 166.06,
    "close": 166.08,
    "volume": 4361.0
  },
  {
    "Unnamed: 0.1": 544,
    "Unnamed: 0": 736,
    "time": 1684185600,
    "open": 166.08,
    "high": 166.09,
    "low": 166.0,
    "close": 166.06,
    "volume": 7399.0
  },
  {
    "Unnamed: 0.1": 545,
    "Unnamed: 0": 737,
    "time": 1684185900,
    "open": 166.05,
    "high": 166.1,
    "low": 166.05,
    "close": 166.06,
    "volume": 8606.0
  },
  {
    "Unnamed: 0.1": 546,
    "Unnamed: 0": 738,
    "time": 1684186200,
    "open": 166.07,
    "high": 166.36,
    "low": 166.06,
    "close": 166.36,
    "volume": 16414.0
  },
  {
    "Unnamed: 0.1": 547,
    "Unnamed: 0": 739,
    "time": 1684186500,
    "open": 166.36,
    "high": 166.5,
    "low": 166.3,
    "close": 166.34,
    "volume": 11073.0
  },
  {
    "Unnamed: 0.1": 548,
    "Unnamed: 0": 740,
    "time": 1684186800,
    "open": 166.32,
    "high": 166.34,
    "low": 166.25,
    "close": 166.26,
    "volume": 6591.0
  },
  {
    "Unnamed: 0.1": 549,
    "Unnamed: 0": 741,
    "time": 1684187100,
    "open": 166.28,
    "high": 166.29,
    "low": 166.25,
    "close": 166.26,
    "volume": 4930.0
  },
  {
    "Unnamed: 0.1": 550,
    "Unnamed: 0": 742,
    "time": 1684187400,
    "open": 166.27,
    "high": 166.32,
    "low": 166.11,
    "close": 166.21,
    "volume": 27758.0
  },
  {
    "Unnamed: 0.1": 551,
    "Unnamed: 0": 743,
    "time": 1684187700,
    "open": 166.26,
    "high": 166.39,
    "low": 166.22,
    "close": 166.37,
    "volume": 13420.0
  },
  {
    "Unnamed: 0.1": 552,
    "Unnamed: 0": 744,
    "time": 1684188000,
    "open": 166.36,
    "high": 166.36,
    "low": 166.31,
    "close": 166.34,
    "volume": 8643.0
  },
  {
    "Unnamed: 0.1": 553,
    "Unnamed: 0": 745,
    "time": 1684188300,
    "open": 166.32,
    "high": 166.32,
    "low": 166.28,
    "close": 166.3,
    "volume": 3553.0
  },
  {
    "Unnamed: 0.1": 554,
    "Unnamed: 0": 746,
    "time": 1684188600,
    "open": 166.29,
    "high": 166.3,
    "low": 166.23,
    "close": 166.24,
    "volume": 7754.0
  },
  {
    "Unnamed: 0.1": 555,
    "Unnamed: 0": 747,
    "time": 1684188900,
    "open": 166.26,
    "high": 166.32,
    "low": 166.24,
    "close": 166.3,
    "volume": 8700.0
  },
  {
    "Unnamed: 0.1": 556,
    "Unnamed: 0": 748,
    "time": 1684189200,
    "open": 166.3,
    "high": 166.31,
    "low": 166.26,
    "close": 166.29,
    "volume": 7121.0
  },
  {
    "Unnamed: 0.1": 557,
    "Unnamed: 0": 749,
    "time": 1684189500,
    "open": 166.32,
    "high": 166.32,
    "low": 166.27,
    "close": 166.28,
    "volume": 12917.0
  },
  {
    "Unnamed: 0.1": 558,
    "Unnamed: 0": 750,
    "time": 1684189800,
    "open": 166.29,
    "high": 166.29,
    "low": 166.15,
    "close": 166.22,
    "volume": 6857.0
  },
  {
    "Unnamed: 0.1": 559,
    "Unnamed: 0": 751,
    "time": 1684190100,
    "open": 166.18,
    "high": 166.25,
    "low": 166.17,
    "close": 166.25,
    "volume": 5082.0
  },
  {
    "Unnamed: 0.1": 560,
    "Unnamed: 0": 752,
    "time": 1684190400,
    "open": 166.24,
    "high": 166.25,
    "low": 166.17,
    "close": 166.23,
    "volume": 7436.0
  },
  {
    "Unnamed: 0.1": 561,
    "Unnamed: 0": 753,
    "time": 1684190700,
    "open": 166.17,
    "high": 166.25,
    "low": 166.17,
    "close": 166.21,
    "volume": 3350.0
  },
  {
    "Unnamed: 0.1": 562,
    "Unnamed: 0": 754,
    "time": 1684191000,
    "open": 166.25,
    "high": 166.28,
    "low": 166.21,
    "close": 166.23,
    "volume": 4405.0
  },
  {
    "Unnamed: 0.1": 563,
    "Unnamed: 0": 755,
    "time": 1684191300,
    "open": 166.21,
    "high": 166.3,
    "low": 166.21,
    "close": 166.29,
    "volume": 1937.0
  },
  {
    "Unnamed: 0.1": 564,
    "Unnamed: 0": 756,
    "time": 1684191600,
    "open": 166.22,
    "high": 166.36,
    "low": 166.21,
    "close": 166.35,
    "volume": 12388.0
  },
  {
    "Unnamed: 0.1": 565,
    "Unnamed: 0": 757,
    "time": 1684191900,
    "open": 166.32,
    "high": 166.35,
    "low": 166.29,
    "close": 166.32,
    "volume": 7931.0
  },
  {
    "Unnamed: 0.1": 566,
    "Unnamed: 0": 758,
    "time": 1684192200,
    "open": 166.3,
    "high": 166.38,
    "low": 166.3,
    "close": 166.37,
    "volume": 3948.0
  },
  {
    "Unnamed: 0.1": 567,
    "Unnamed: 0": 759,
    "time": 1684192500,
    "open": 166.37,
    "high": 166.38,
    "low": 166.3,
    "close": 166.35,
    "volume": 4265.0
  },
  {
    "Unnamed: 0.1": 568,
    "Unnamed: 0": 760,
    "time": 1684192800,
    "open": 166.32,
    "high": 166.38,
    "low": 166.32,
    "close": 166.38,
    "volume": 1927.0
  },
  {
    "Unnamed: 0.1": 569,
    "Unnamed: 0": 761,
    "time": 1684193100,
    "open": 166.35,
    "high": 166.4,
    "low": 166.34,
    "close": 166.35,
    "volume": 3919.0
  },
  {
    "Unnamed: 0.1": 570,
    "Unnamed: 0": 762,
    "time": 1684193400,
    "open": 166.35,
    "high": 166.47,
    "low": 166.34,
    "close": 166.43,
    "volume": 8934.0
  },
  {
    "Unnamed: 0.1": 571,
    "Unnamed: 0": 763,
    "time": 1684193700,
    "open": 166.45,
    "high": 166.5,
    "low": 166.37,
    "close": 166.43,
    "volume": 6408.0
  },
  {
    "Unnamed: 0.1": 572,
    "Unnamed: 0": 764,
    "time": 1684194000,
    "open": 166.41,
    "high": 166.45,
    "low": 166.37,
    "close": 166.4,
    "volume": 5284.0
  },
  {
    "Unnamed: 0.1": 573,
    "Unnamed: 0": 765,
    "time": 1684194300,
    "open": 166.4,
    "high": 166.5,
    "low": 166.37,
    "close": 166.41,
    "volume": 11600.0
  },
  {
    "Unnamed: 0.1": 574,
    "Unnamed: 0": 766,
    "time": 1684194600,
    "open": 166.42,
    "high": 166.45,
    "low": 166.38,
    "close": 166.39,
    "volume": 15489.0
  },
  {
    "Unnamed: 0.1": 575,
    "Unnamed: 0": 767,
    "time": 1684194900,
    "open": 166.4,
    "high": 166.55,
    "low": 166.38,
    "close": 166.51,
    "volume": 39750.0
  },
  {
    "Unnamed: 0.1": 576,
    "Unnamed: 0": 768,
    "time": 1684310400,
    "open": 168.82,
    "high": 169.32,
    "low": 168.52,
    "close": 168.97,
    "volume": 22369.0
  },
  {
    "Unnamed: 0.1": 577,
    "Unnamed: 0": 769,
    "time": 1684310700,
    "open": 168.82,
    "high": 169.1,
    "low": 168.7,
    "close": 168.8,
    "volume": 7963.0
  },
  {
    "Unnamed: 0.1": 578,
    "Unnamed: 0": 770,
    "time": 1684311000,
    "open": 168.76,
    "high": 168.89,
    "low": 168.66,
    "close": 168.87,
    "volume": 4374.0
  },
  {
    "Unnamed: 0.1": 579,
    "Unnamed: 0": 771,
    "time": 1684311300,
    "open": 168.9,
    "high": 169.06,
    "low": 168.8,
    "close": 169.05,
    "volume": 2857.0
  },
  {
    "Unnamed: 0.1": 580,
    "Unnamed: 0": 772,
    "time": 1684311600,
    "open": 169.0,
    "high": 169.17,
    "low": 168.92,
    "close": 169.03,
    "volume": 7544.0
  },
  {
    "Unnamed: 0.1": 581,
    "Unnamed: 0": 773,
    "time": 1684311900,
    "open": 169.01,
    "high": 169.01,
    "low": 168.83,
    "close": 168.83,
    "volume": 3094.0
  },
  {
    "Unnamed: 0.1": 582,
    "Unnamed: 0": 774,
    "time": 1684312200,
    "open": 168.86,
    "high": 168.96,
    "low": 168.84,
    "close": 168.96,
    "volume": 1723.0
  },
  {
    "Unnamed: 0.1": 583,
    "Unnamed: 0": 775,
    "time": 1684312500,
    "open": 168.92,
    "high": 168.92,
    "low": 168.87,
    "close": 168.87,
    "volume": 1940.0
  },
  {
    "Unnamed: 0.1": 584,
    "Unnamed: 0": 776,
    "time": 1684312800,
    "open": 168.96,
    "high": 169.0,
    "low": 168.91,
    "close": 168.92,
    "volume": 3909.0
  },
  {
    "Unnamed: 0.1": 585,
    "Unnamed: 0": 777,
    "time": 1684313100,
    "open": 168.98,
    "high": 169.02,
    "low": 168.96,
    "close": 169.02,
    "volume": 4432.0
  },
  {
    "Unnamed: 0.1": 586,
    "Unnamed: 0": 778,
    "time": 1684313400,
    "open": 169.04,
    "high": 169.05,
    "low": 168.96,
    "close": 169.04,
    "volume": 4009.0
  },
  {
    "Unnamed: 0.1": 587,
    "Unnamed: 0": 779,
    "time": 1684313700,
    "open": 169.02,
    "high": 169.08,
    "low": 168.92,
    "close": 169.08,
    "volume": 3672.0
  },
  {
    "Unnamed: 0.1": 588,
    "Unnamed: 0": 780,
    "time": 1684314000,
    "open": 169.08,
    "high": 169.16,
    "low": 169.01,
    "close": 169.01,
    "volume": 4234.0
  },
  {
    "Unnamed: 0.1": 589,
    "Unnamed: 0": 781,
    "time": 1684314300,
    "open": 169.09,
    "high": 169.1,
    "low": 168.95,
    "close": 168.95,
    "volume": 2860.0
  },
  {
    "Unnamed: 0.1": 590,
    "Unnamed: 0": 782,
    "time": 1684314600,
    "open": 168.92,
    "high": 168.92,
    "low": 168.85,
    "close": 168.85,
    "volume": 4602.0
  },
  {
    "Unnamed: 0.1": 591,
    "Unnamed: 0": 783,
    "time": 1684314900,
    "open": 168.85,
    "high": 168.85,
    "low": 168.85,
    "close": 168.85,
    "volume": 653.0
  },
  {
    "Unnamed: 0.1": 592,
    "Unnamed: 0": 784,
    "time": 1684315200,
    "open": 168.85,
    "high": 168.9,
    "low": 168.85,
    "close": 168.9,
    "volume": 279.0
  },
  {
    "Unnamed: 0.1": 593,
    "Unnamed: 0": 785,
    "time": 1684315500,
    "open": 168.87,
    "high": 168.93,
    "low": 168.87,
    "close": 168.89,
    "volume": 2932.0
  },
  {
    "Unnamed: 0.1": 594,
    "Unnamed: 0": 786,
    "time": 1684315800,
    "open": 168.8,
    "high": 168.93,
    "low": 168.8,
    "close": 168.91,
    "volume": 3477.0
  },
  {
    "Unnamed: 0.1": 595,
    "Unnamed: 0": 787,
    "time": 1684316100,
    "open": 168.93,
    "high": 168.93,
    "low": 168.85,
    "close": 168.85,
    "volume": 849.0
  },
  {
    "Unnamed: 0.1": 596,
    "Unnamed: 0": 788,
    "time": 1684316400,
    "open": 168.85,
    "high": 168.86,
    "low": 168.62,
    "close": 168.75,
    "volume": 4562.0
  },
  {
    "Unnamed: 0.1": 597,
    "Unnamed: 0": 789,
    "time": 1684316700,
    "open": 168.68,
    "high": 168.9,
    "low": 168.66,
    "close": 168.8,
    "volume": 4784.0
  },
  {
    "Unnamed: 0.1": 598,
    "Unnamed: 0": 790,
    "time": 1684317000,
    "open": 168.74,
    "high": 168.97,
    "low": 168.73,
    "close": 168.97,
    "volume": 3372.0
  },
  {
    "Unnamed: 0.1": 599,
    "Unnamed: 0": 791,
    "time": 1684317300,
    "open": 168.97,
    "high": 169.0,
    "low": 168.95,
    "close": 168.99,
    "volume": 5959.0
  },
  {
    "Unnamed: 0.1": 600,
    "Unnamed: 0": 792,
    "time": 1684317600,
    "open": 168.96,
    "high": 169.0,
    "low": 168.93,
    "close": 168.96,
    "volume": 3396.0
  },
  {
    "Unnamed: 0.1": 601,
    "Unnamed: 0": 793,
    "time": 1684317900,
    "open": 168.94,
    "high": 168.96,
    "low": 168.94,
    "close": 168.96,
    "volume": 962.0
  },
  {
    "Unnamed: 0.1": 602,
    "Unnamed: 0": 794,
    "time": 1684318200,
    "open": 168.96,
    "high": 169.1,
    "low": 168.96,
    "close": 169.09,
    "volume": 4039.0
  },
  {
    "Unnamed: 0.1": 603,
    "Unnamed: 0": 795,
    "time": 1684318500,
    "open": 169.06,
    "high": 169.17,
    "low": 169.06,
    "close": 169.17,
    "volume": 6967.0
  },
  {
    "Unnamed: 0.1": 604,
    "Unnamed: 0": 796,
    "time": 1684318800,
    "open": 169.2,
    "high": 169.23,
    "low": 168.92,
    "close": 168.97,
    "volume": 8261.0
  },
  {
    "Unnamed: 0.1": 605,
    "Unnamed: 0": 797,
    "time": 1684319100,
    "open": 168.97,
    "high": 169.09,
    "low": 168.93,
    "close": 169.09,
    "volume": 2738.0
  },
  {
    "Unnamed: 0.1": 606,
    "Unnamed: 0": 798,
    "time": 1684319400,
    "open": 169.07,
    "high": 169.1,
    "low": 168.92,
    "close": 169.04,
    "volume": 3196.0
  },
  {
    "Unnamed: 0.1": 607,
    "Unnamed: 0": 799,
    "time": 1684319700,
    "open": 169.0,
    "high": 169.0,
    "low": 168.72,
    "close": 168.77,
    "volume": 6891.0
  },
  {
    "Unnamed: 0.1": 608,
    "Unnamed: 0": 800,
    "time": 1684320000,
    "open": 168.75,
    "high": 168.94,
    "low": 168.75,
    "close": 168.94,
    "volume": 3140.0
  },
  {
    "Unnamed: 0.1": 609,
    "Unnamed: 0": 801,
    "time": 1684320300,
    "open": 168.94,
    "high": 169.07,
    "low": 168.94,
    "close": 169.02,
    "volume": 2744.0
  },
  {
    "Unnamed: 0.1": 610,
    "Unnamed: 0": 802,
    "time": 1684320600,
    "open": 169.07,
    "high": 169.07,
    "low": 169.05,
    "close": 169.05,
    "volume": 1369.0
  },
  {
    "Unnamed: 0.1": 611,
    "Unnamed: 0": 803,
    "time": 1684320900,
    "open": 169.1,
    "high": 169.48,
    "low": 169.09,
    "close": 169.4,
    "volume": 10297.0
  },
  {
    "Unnamed: 0.1": 612,
    "Unnamed: 0": 804,
    "time": 1684321200,
    "open": 169.36,
    "high": 169.75,
    "low": 169.3,
    "close": 169.49,
    "volume": 64135.0
  },
  {
    "Unnamed: 0.1": 613,
    "Unnamed: 0": 805,
    "time": 1684321500,
    "open": 169.49,
    "high": 169.54,
    "low": 169.01,
    "close": 169.07,
    "volume": 27817.0
  },
  {
    "Unnamed: 0.1": 614,
    "Unnamed: 0": 806,
    "time": 1684321800,
    "open": 169.08,
    "high": 169.28,
    "low": 168.86,
    "close": 169.2,
    "volume": 25625.0
  },
  {
    "Unnamed: 0.1": 615,
    "Unnamed: 0": 807,
    "time": 1684322100,
    "open": 169.18,
    "high": 169.2,
    "low": 168.31,
    "close": 168.6,
    "volume": 39460.0
  },
  {
    "Unnamed: 0.1": 616,
    "Unnamed: 0": 808,
    "time": 1684322400,
    "open": 168.66,
    "high": 168.79,
    "low": 168.59,
    "close": 168.77,
    "volume": 11640.0
  },
  {
    "Unnamed: 0.1": 617,
    "Unnamed: 0": 809,
    "time": 1684322700,
    "open": 168.78,
    "high": 168.85,
    "low": 168.75,
    "close": 168.8,
    "volume": 11661.0
  },
  {
    "Unnamed: 0.1": 618,
    "Unnamed: 0": 810,
    "time": 1684323000,
    "open": 168.82,
    "high": 169.17,
    "low": 168.82,
    "close": 168.98,
    "volume": 11849.0
  },
  {
    "Unnamed: 0.1": 619,
    "Unnamed: 0": 811,
    "time": 1684323300,
    "open": 169.08,
    "high": 169.11,
    "low": 168.96,
    "close": 169.02,
    "volume": 12255.0
  },
  {
    "Unnamed: 0.1": 620,
    "Unnamed: 0": 812,
    "time": 1684323600,
    "open": 169.0,
    "high": 169.2,
    "low": 169.0,
    "close": 169.16,
    "volume": 15820.0
  },
  {
    "Unnamed: 0.1": 621,
    "Unnamed: 0": 813,
    "time": 1684323900,
    "open": 169.14,
    "high": 169.15,
    "low": 169.05,
    "close": 169.14,
    "volume": 4235.0
  },
  {
    "Unnamed: 0.1": 622,
    "Unnamed: 0": 814,
    "time": 1684324200,
    "open": 169.1,
    "high": 169.16,
    "low": 168.88,
    "close": 168.94,
    "volume": 8318.0
  },
  {
    "Unnamed: 0.1": 623,
    "Unnamed: 0": 815,
    "time": 1684324500,
    "open": 168.94,
    "high": 169.03,
    "low": 168.94,
    "close": 169.03,
    "volume": 2492.0
  },
  {
    "Unnamed: 0.1": 624,
    "Unnamed: 0": 816,
    "time": 1684324800,
    "open": 169.71,
    "high": 169.74,
    "low": 168.31,
    "close": 168.47,
    "volume": 254856.0
  },
  {
    "Unnamed: 0.1": 625,
    "Unnamed: 0": 817,
    "time": 1684325100,
    "open": 168.55,
    "high": 168.8,
    "low": 168.33,
    "close": 168.75,
    "volume": 48052.0
  },
  {
    "Unnamed: 0.1": 626,
    "Unnamed: 0": 818,
    "time": 1684325400,
    "open": 168.7,
    "high": 168.81,
    "low": 168.43,
    "close": 168.6,
    "volume": 36045.0
  },
  {
    "Unnamed: 0.1": 627,
    "Unnamed: 0": 819,
    "time": 1684325700,
    "open": 168.52,
    "high": 168.59,
    "low": 168.45,
    "close": 168.5,
    "volume": 33019.0
  },
  {
    "Unnamed: 0.1": 628,
    "Unnamed: 0": 820,
    "time": 1684326000,
    "open": 168.54,
    "high": 168.6,
    "low": 168.33,
    "close": 168.39,
    "volume": 44151.0
  },
  {
    "Unnamed: 0.1": 629,
    "Unnamed: 0": 821,
    "time": 1684326300,
    "open": 168.45,
    "high": 168.51,
    "low": 168.25,
    "close": 168.5,
    "volume": 45634.0
  },
  {
    "Unnamed: 0.1": 630,
    "Unnamed: 0": 822,
    "time": 1684326600,
    "open": 168.51,
    "high": 168.79,
    "low": 168.4,
    "close": 168.77,
    "volume": 55131.0
  },
  {
    "Unnamed: 0.1": 631,
    "Unnamed: 0": 823,
    "time": 1684326900,
    "open": 168.77,
    "high": 168.77,
    "low": 168.5,
    "close": 168.66,
    "volume": 30749.0
  },
  {
    "Unnamed: 0.1": 632,
    "Unnamed: 0": 824,
    "time": 1684327200,
    "open": 168.6,
    "high": 168.95,
    "low": 168.56,
    "close": 168.87,
    "volume": 32653.0
  },
  {
    "Unnamed: 0.1": 633,
    "Unnamed: 0": 825,
    "time": 1684327500,
    "open": 168.86,
    "high": 168.93,
    "low": 168.6,
    "close": 168.79,
    "volume": 31536.0
  },
  {
    "Unnamed: 0.1": 634,
    "Unnamed: 0": 826,
    "time": 1684327800,
    "open": 168.8,
    "high": 169.01,
    "low": 168.76,
    "close": 168.9,
    "volume": 30046.0
  },
  {
    "Unnamed: 0.1": 635,
    "Unnamed: 0": 827,
    "time": 1684328100,
    "open": 168.86,
    "high": 168.86,
    "low": 168.65,
    "close": 168.75,
    "volume": 37352.0
  },
  {
    "Unnamed: 0.1": 636,
    "Unnamed: 0": 828,
    "time": 1684328400,
    "open": 168.74,
    "high": 168.8,
    "low": 168.46,
    "close": 168.7,
    "volume": 45051.0
  },
  {
    "Unnamed: 0.1": 637,
    "Unnamed: 0": 829,
    "time": 1684328700,
    "open": 168.74,
    "high": 168.87,
    "low": 168.71,
    "close": 168.8,
    "volume": 40038.0
  },
  {
    "Unnamed: 0.1": 638,
    "Unnamed: 0": 830,
    "time": 1684329000,
    "open": 168.81,
    "high": 168.81,
    "low": 168.63,
    "close": 168.67,
    "volume": 27711.0
  },
  {
    "Unnamed: 0.1": 639,
    "Unnamed: 0": 831,
    "time": 1684329300,
    "open": 168.67,
    "high": 168.73,
    "low": 168.65,
    "close": 168.68,
    "volume": 19216.0
  },
  {
    "Unnamed: 0.1": 640,
    "Unnamed: 0": 832,
    "time": 1684329600,
    "open": 168.68,
    "high": 168.73,
    "low": 168.4,
    "close": 168.55,
    "volume": 53914.0
  },
  {
    "Unnamed: 0.1": 641,
    "Unnamed: 0": 833,
    "time": 1684329900,
    "open": 168.63,
    "high": 168.9,
    "low": 168.0,
    "close": 168.36,
    "volume": 90976.0
  },
  {
    "Unnamed: 0.1": 642,
    "Unnamed: 0": 834,
    "time": 1684330200,
    "open": 168.41,
    "high": 168.47,
    "low": 167.18,
    "close": 167.41,
    "volume": 3237526.0
  },
  {
    "Unnamed: 0.1": 643,
    "Unnamed: 0": 835,
    "time": 1684330500,
    "open": 167.43,
    "high": 168.24,
    "low": 167.23,
    "close": 167.92,
    "volume": 2348795.0
  },
  {
    "Unnamed: 0.1": 644,
    "Unnamed: 0": 836,
    "time": 1684330800,
    "open": 167.93,
    "high": 169.86,
    "low": 167.9,
    "close": 169.73,
    "volume": 4096219.0
  },
  {
    "Unnamed: 0.1": 645,
    "Unnamed: 0": 837,
    "time": 1684331100,
    "open": 169.75,
    "high": 170.54,
    "low": 169.4,
    "close": 170.34,
    "volume": 3607257.0
  },
  {
    "Unnamed: 0.1": 646,
    "Unnamed: 0": 838,
    "time": 1684331400,
    "open": 170.36,
    "high": 170.69,
    "low": 169.54,
    "close": 169.93,
    "volume": 2868151.0
  },
  {
    "Unnamed: 0.1": 647,
    "Unnamed: 0": 839,
    "time": 1684331700,
    "open": 169.93,
    "high": 170.04,
    "low": 169.39,
    "close": 169.7,
    "volume": 1839049.0
  },
  {
    "Unnamed: 0.1": 648,
    "Unnamed: 0": 840,
    "time": 1684332000,
    "open": 169.72,
    "high": 170.67,
    "low": 169.62,
    "close": 170.3,
    "volume": 2296906.0
  },
  {
    "Unnamed: 0.1": 649,
    "Unnamed: 0": 841,
    "time": 1684332300,
    "open": 170.28,
    "high": 171.31,
    "low": 170.26,
    "close": 171.21,
    "volume": 2889474.0
  },
  {
    "Unnamed: 0.1": 650,
    "Unnamed: 0": 842,
    "time": 1684332600,
    "open": 171.21,
    "high": 172.29,
    "low": 171.18,
    "close": 172.19,
    "volume": 3484522.0
  },
  {
    "Unnamed: 0.1": 651,
    "Unnamed: 0": 843,
    "time": 1684332900,
    "open": 172.19,
    "high": 172.19,
    "low": 171.52,
    "close": 171.74,
    "volume": 2207691.0
  },
  {
    "Unnamed: 0.1": 652,
    "Unnamed: 0": 844,
    "time": 1684333200,
    "open": 171.75,
    "high": 172.15,
    "low": 171.32,
    "close": 171.53,
    "volume": 1956938.0
  },
  {
    "Unnamed: 0.1": 653,
    "Unnamed: 0": 845,
    "time": 1684333500,
    "open": 171.51,
    "high": 172.12,
    "low": 171.44,
    "close": 171.82,
    "volume": 1712496.0
  },
  {
    "Unnamed: 0.1": 654,
    "Unnamed: 0": 846,
    "time": 1684333800,
    "open": 171.82,
    "high": 172.64,
    "low": 171.81,
    "close": 172.57,
    "volume": 2633178.0
  },
  {
    "Unnamed: 0.1": 655,
    "Unnamed: 0": 847,
    "time": 1684334100,
    "open": 172.57,
    "high": 172.78,
    "low": 172.0,
    "close": 172.75,
    "volume": 2096127.0
  },
  {
    "Unnamed: 0.1": 656,
    "Unnamed: 0": 848,
    "time": 1684334400,
    "open": 172.74,
    "high": 172.98,
    "low": 172.56,
    "close": 172.75,
    "volume": 1730105.0
  },
  {
    "Unnamed: 0.1": 657,
    "Unnamed: 0": 849,
    "time": 1684334700,
    "open": 172.77,
    "high": 173.36,
    "low": 172.57,
    "close": 173.06,
    "volume": 2453817.0
  },
  {
    "Unnamed: 0.1": 658,
    "Unnamed: 0": 850,
    "time": 1684335000,
    "open": 173.06,
    "high": 173.99,
    "low": 173.05,
    "close": 173.82,
    "volume": 2651801.0
  },
  {
    "Unnamed: 0.1": 659,
    "Unnamed: 0": 851,
    "time": 1684335300,
    "open": 173.83,
    "high": 173.94,
    "low": 173.29,
    "close": 173.31,
    "volume": 2085515.0
  },
  {
    "Unnamed: 0.1": 660,
    "Unnamed: 0": 852,
    "time": 1684335600,
    "open": 173.31,
    "high": 173.66,
    "low": 172.81,
    "close": 172.86,
    "volume": 1904058.0
  },
  {
    "Unnamed: 0.1": 661,
    "Unnamed: 0": 853,
    "time": 1684335900,
    "open": 172.87,
    "high": 173.37,
    "low": 172.71,
    "close": 173.21,
    "volume": 1771292.0
  },
  {
    "Unnamed: 0.1": 662,
    "Unnamed: 0": 854,
    "time": 1684336200,
    "open": 173.21,
    "high": 173.27,
    "low": 172.37,
    "close": 172.69,
    "volume": 1738681.0
  },
  {
    "Unnamed: 0.1": 663,
    "Unnamed: 0": 855,
    "time": 1684336500,
    "open": 172.7,
    "high": 173.49,
    "low": 172.6,
    "close": 173.13,
    "volume": 1844009.0
  },
  {
    "Unnamed: 0.1": 664,
    "Unnamed: 0": 856,
    "time": 1684336800,
    "open": 173.11,
    "high": 173.2,
    "low": 172.54,
    "close": 173.18,
    "volume": 1500089.0
  },
  {
    "Unnamed: 0.1": 665,
    "Unnamed: 0": 857,
    "time": 1684337100,
    "open": 173.18,
    "high": 173.27,
    "low": 172.86,
    "close": 173.23,
    "volume": 1128781.0
  },
  {
    "Unnamed: 0.1": 666,
    "Unnamed: 0": 858,
    "time": 1684337400,
    "open": 173.24,
    "high": 173.39,
    "low": 173.11,
    "close": 173.23,
    "volume": 934139.0
  },
  {
    "Unnamed: 0.1": 667,
    "Unnamed: 0": 859,
    "time": 1684337700,
    "open": 173.23,
    "high": 173.25,
    "low": 172.82,
    "close": 173.19,
    "volume": 1115222.0
  },
  {
    "Unnamed: 0.1": 668,
    "Unnamed: 0": 860,
    "time": 1684338000,
    "open": 173.19,
    "high": 173.45,
    "low": 173.1,
    "close": 173.33,
    "volume": 1134111.0
  },
  {
    "Unnamed: 0.1": 669,
    "Unnamed: 0": 861,
    "time": 1684338300,
    "open": 173.35,
    "high": 173.74,
    "low": 173.34,
    "close": 173.64,
    "volume": 1351075.0
  },
  {
    "Unnamed: 0.1": 670,
    "Unnamed: 0": 862,
    "time": 1684338600,
    "open": 173.63,
    "high": 173.8,
    "low": 173.53,
    "close": 173.6,
    "volume": 928504.0
  },
  {
    "Unnamed: 0.1": 671,
    "Unnamed: 0": 863,
    "time": 1684338900,
    "open": 173.59,
    "high": 173.75,
    "low": 173.28,
    "close": 173.56,
    "volume": 906862.0
  },
  {
    "Unnamed: 0.1": 672,
    "Unnamed: 0": 864,
    "time": 1684339200,
    "open": 173.56,
    "high": 173.58,
    "low": 173.03,
    "close": 173.22,
    "volume": 906361.0
  },
  {
    "Unnamed: 0.1": 673,
    "Unnamed: 0": 865,
    "time": 1684339500,
    "open": 173.21,
    "high": 173.27,
    "low": 172.85,
    "close": 173.17,
    "volume": 1078571.0
  },
  {
    "Unnamed: 0.1": 674,
    "Unnamed: 0": 866,
    "time": 1684339800,
    "open": 173.16,
    "high": 173.31,
    "low": 173.02,
    "close": 173.23,
    "volume": 714565.0
  },
  {
    "Unnamed: 0.1": 675,
    "Unnamed: 0": 867,
    "time": 1684340100,
    "open": 173.23,
    "high": 173.24,
    "low": 172.62,
    "close": 172.77,
    "volume": 938732.0
  },
  {
    "Unnamed: 0.1": 676,
    "Unnamed: 0": 868,
    "time": 1684340400,
    "open": 172.77,
    "high": 173.06,
    "low": 172.63,
    "close": 172.78,
    "volume": 822914.0
  },
  {
    "Unnamed: 0.1": 677,
    "Unnamed: 0": 869,
    "time": 1684340700,
    "open": 172.78,
    "high": 172.81,
    "low": 172.36,
    "close": 172.66,
    "volume": 1090598.0
  },
  {
    "Unnamed: 0.1": 678,
    "Unnamed: 0": 870,
    "time": 1684341000,
    "open": 172.68,
    "high": 173.19,
    "low": 172.64,
    "close": 173.17,
    "volume": 1025232.0
  },
  {
    "Unnamed: 0.1": 679,
    "Unnamed: 0": 871,
    "time": 1684341300,
    "open": 173.16,
    "high": 173.42,
    "low": 173.03,
    "close": 173.36,
    "volume": 783554.0
  },
  {
    "Unnamed: 0.1": 680,
    "Unnamed: 0": 872,
    "time": 1684341600,
    "open": 173.38,
    "high": 173.41,
    "low": 173.02,
    "close": 173.2,
    "volume": 796927.0
  },
  {
    "Unnamed: 0.1": 681,
    "Unnamed: 0": 873,
    "time": 1684341900,
    "open": 173.19,
    "high": 173.39,
    "low": 172.94,
    "close": 173.04,
    "volume": 777882.0
  },
  {
    "Unnamed: 0.1": 682,
    "Unnamed: 0": 874,
    "time": 1684342200,
    "open": 173.04,
    "high": 173.18,
    "low": 172.9,
    "close": 173.08,
    "volume": 604312.0
  },
  {
    "Unnamed: 0.1": 683,
    "Unnamed: 0": 875,
    "time": 1684342500,
    "open": 173.09,
    "high": 173.25,
    "low": 172.74,
    "close": 172.99,
    "volume": 925942.0
  },
  {
    "Unnamed: 0.1": 684,
    "Unnamed: 0": 876,
    "time": 1684342800,
    "open": 173.0,
    "high": 173.16,
    "low": 172.7,
    "close": 173.1,
    "volume": 767561.0
  },
  {
    "Unnamed: 0.1": 685,
    "Unnamed: 0": 877,
    "time": 1684343100,
    "open": 173.09,
    "high": 173.33,
    "low": 173.09,
    "close": 173.18,
    "volume": 866314.0
  },
  {
    "Unnamed: 0.1": 686,
    "Unnamed: 0": 878,
    "time": 1684343400,
    "open": 173.17,
    "high": 173.28,
    "low": 173.01,
    "close": 173.04,
    "volume": 567099.0
  },
  {
    "Unnamed: 0.1": 687,
    "Unnamed: 0": 879,
    "time": 1684343700,
    "open": 173.04,
    "high": 173.23,
    "low": 172.86,
    "close": 173.16,
    "volume": 656240.0
  },
  {
    "Unnamed: 0.1": 688,
    "Unnamed: 0": 880,
    "time": 1684344000,
    "open": 173.18,
    "high": 173.49,
    "low": 173.11,
    "close": 173.32,
    "volume": 801136.0
  },
  {
    "Unnamed: 0.1": 689,
    "Unnamed: 0": 881,
    "time": 1684344300,
    "open": 173.32,
    "high": 173.56,
    "low": 173.27,
    "close": 173.46,
    "volume": 684316.0
  },
  {
    "Unnamed: 0.1": 690,
    "Unnamed: 0": 882,
    "time": 1684344600,
    "open": 173.46,
    "high": 173.84,
    "low": 173.42,
    "close": 173.84,
    "volume": 880024.0
  },
  {
    "Unnamed: 0.1": 691,
    "Unnamed: 0": 883,
    "time": 1684344900,
    "open": 173.83,
    "high": 174.22,
    "low": 173.61,
    "close": 174.01,
    "volume": 1723090.0
  },
  {
    "Unnamed: 0.1": 692,
    "Unnamed: 0": 884,
    "time": 1684345200,
    "open": 174.0,
    "high": 174.01,
    "low": 173.71,
    "close": 173.81,
    "volume": 749723.0
  },
  {
    "Unnamed: 0.1": 693,
    "Unnamed: 0": 885,
    "time": 1684345500,
    "open": 173.81,
    "high": 174.14,
    "low": 173.78,
    "close": 174.08,
    "volume": 801425.0
  },
  {
    "Unnamed: 0.1": 694,
    "Unnamed: 0": 886,
    "time": 1684345800,
    "open": 174.09,
    "high": 174.16,
    "low": 173.84,
    "close": 173.92,
    "volume": 787372.0
  },
  {
    "Unnamed: 0.1": 695,
    "Unnamed: 0": 887,
    "time": 1684346100,
    "open": 173.91,
    "high": 174.02,
    "low": 173.76,
    "close": 173.93,
    "volume": 569371.0
  },
  {
    "Unnamed: 0.1": 696,
    "Unnamed: 0": 888,
    "time": 1684346400,
    "open": 173.94,
    "high": 173.97,
    "low": 173.62,
    "close": 173.67,
    "volume": 692782.0
  },
  {
    "Unnamed: 0.1": 697,
    "Unnamed: 0": 889,
    "time": 1684346700,
    "open": 173.67,
    "high": 173.75,
    "low": 173.42,
    "close": 173.59,
    "volume": 882995.0
  },
  {
    "Unnamed: 0.1": 698,
    "Unnamed: 0": 890,
    "time": 1684347000,
    "open": 173.61,
    "high": 173.9,
    "low": 173.53,
    "close": 173.83,
    "volume": 607256.0
  },
  {
    "Unnamed: 0.1": 699,
    "Unnamed: 0": 891,
    "time": 1684347300,
    "open": 173.84,
    "high": 173.85,
    "low": 173.46,
    "close": 173.7,
    "volume": 623099.0
  },
  {
    "Unnamed: 0.1": 700,
    "Unnamed: 0": 892,
    "time": 1684347600,
    "open": 173.7,
    "high": 173.98,
    "low": 173.65,
    "close": 173.96,
    "volume": 681688.0
  },
  {
    "Unnamed: 0.1": 701,
    "Unnamed: 0": 893,
    "time": 1684347900,
    "open": 173.95,
    "high": 174.04,
    "low": 173.8,
    "close": 173.86,
    "volume": 724313.0
  },
  {
    "Unnamed: 0.1": 702,
    "Unnamed: 0": 894,
    "time": 1684348200,
    "open": 173.89,
    "high": 174.02,
    "low": 173.61,
    "close": 173.73,
    "volume": 778009.0
  },
  {
    "Unnamed: 0.1": 703,
    "Unnamed: 0": 895,
    "time": 1684348500,
    "open": 173.72,
    "high": 174.17,
    "low": 173.72,
    "close": 174.03,
    "volume": 876929.0
  },
  {
    "Unnamed: 0.1": 704,
    "Unnamed: 0": 896,
    "time": 1684348800,
    "open": 174.03,
    "high": 174.13,
    "low": 173.45,
    "close": 173.47,
    "volume": 948306.0
  },
  {
    "Unnamed: 0.1": 705,
    "Unnamed: 0": 897,
    "time": 1684349100,
    "open": 173.47,
    "high": 173.69,
    "low": 173.2,
    "close": 173.68,
    "volume": 933124.0
  },
  {
    "Unnamed: 0.1": 706,
    "Unnamed: 0": 898,
    "time": 1684349400,
    "open": 173.68,
    "high": 173.7,
    "low": 173.43,
    "close": 173.62,
    "volume": 603297.0
  },
  {
    "Unnamed: 0.1": 707,
    "Unnamed: 0": 899,
    "time": 1684349700,
    "open": 173.62,
    "high": 173.65,
    "low": 173.41,
    "close": 173.49,
    "volume": 576137.0
  },
  {
    "Unnamed: 0.1": 708,
    "Unnamed: 0": 900,
    "time": 1684350000,
    "open": 173.47,
    "high": 173.87,
    "low": 173.34,
    "close": 173.85,
    "volume": 896119.0
  },
  {
    "Unnamed: 0.1": 709,
    "Unnamed: 0": 901,
    "time": 1684350300,
    "open": 173.84,
    "high": 174.21,
    "low": 173.79,
    "close": 174.19,
    "volume": 1030060.0
  },
  {
    "Unnamed: 0.1": 710,
    "Unnamed: 0": 902,
    "time": 1684350600,
    "open": 174.17,
    "high": 174.5,
    "low": 174.02,
    "close": 174.15,
    "volume": 1034142.0
  },
  {
    "Unnamed: 0.1": 711,
    "Unnamed: 0": 903,
    "time": 1684350900,
    "open": 174.15,
    "high": 174.25,
    "low": 173.95,
    "close": 174.05,
    "volume": 776574.0
  },
  {
    "Unnamed: 0.1": 712,
    "Unnamed: 0": 904,
    "time": 1684351200,
    "open": 174.05,
    "high": 174.24,
    "low": 173.87,
    "close": 173.99,
    "volume": 780633.0
  },
  {
    "Unnamed: 0.1": 713,
    "Unnamed: 0": 905,
    "time": 1684351500,
    "open": 173.99,
    "high": 174.14,
    "low": 173.81,
    "close": 173.91,
    "volume": 573551.0
  },
  {
    "Unnamed: 0.1": 714,
    "Unnamed: 0": 906,
    "time": 1684351800,
    "open": 173.91,
    "high": 174.14,
    "low": 173.86,
    "close": 174.0,
    "volume": 714225.0
  },
  {
    "Unnamed: 0.1": 715,
    "Unnamed: 0": 907,
    "time": 1684352100,
    "open": 174.0,
    "high": 174.44,
    "low": 173.9,
    "close": 174.36,
    "volume": 1059065.0
  },
  {
    "Unnamed: 0.1": 716,
    "Unnamed: 0": 908,
    "time": 1684352400,
    "open": 174.35,
    "high": 174.5,
    "low": 174.21,
    "close": 174.27,
    "volume": 1040799.0
  },
  {
    "Unnamed: 0.1": 717,
    "Unnamed: 0": 909,
    "time": 1684352700,
    "open": 174.26,
    "high": 174.39,
    "low": 174.19,
    "close": 174.26,
    "volume": 769384.0
  },
  {
    "Unnamed: 0.1": 718,
    "Unnamed: 0": 910,
    "time": 1684353000,
    "open": 174.27,
    "high": 174.38,
    "low": 173.58,
    "close": 173.73,
    "volume": 1564731.0
  },
  {
    "Unnamed: 0.1": 719,
    "Unnamed: 0": 911,
    "time": 1684353300,
    "open": 173.74,
    "high": 174.0,
    "low": 173.72,
    "close": 173.85,
    "volume": 1803519.0
  },
  {
    "Unnamed: 0.1": 720,
    "Unnamed: 0": 912,
    "time": 1684353600,
    "open": 173.86,
    "high": 174.02,
    "low": 173.66,
    "close": 173.99,
    "volume": 2406815.0
  },
  {
    "Unnamed: 0.1": 721,
    "Unnamed: 0": 913,
    "time": 1684353900,
    "open": 173.94,
    "high": 174.11,
    "low": 173.86,
    "close": 174.09,
    "volume": 97778.0
  },
  {
    "Unnamed: 0.1": 722,
    "Unnamed: 0": 914,
    "time": 1684354200,
    "open": 174.05,
    "high": 174.09,
    "low": 173.86,
    "close": 174.05,
    "volume": 25230.0
  },
  {
    "Unnamed: 0.1": 723,
    "Unnamed: 0": 915,
    "time": 1684354500,
    "open": 174.05,
    "high": 174.11,
    "low": 174.02,
    "close": 174.1,
    "volume": 32255.0
  },
  {
    "Unnamed: 0.1": 724,
    "Unnamed: 0": 916,
    "time": 1684354800,
    "open": 174.1,
    "high": 174.2,
    "low": 173.86,
    "close": 174.12,
    "volume": 23698.0
  },
  {
    "Unnamed: 0.1": 725,
    "Unnamed: 0": 917,
    "time": 1684355100,
    "open": 174.12,
    "high": 174.14,
    "low": 173.96,
    "close": 173.97,
    "volume": 21001.0
  },
  {
    "Unnamed: 0.1": 726,
    "Unnamed: 0": 918,
    "time": 1684355400,
    "open": 173.97,
    "high": 173.98,
    "low": 173.93,
    "close": 173.96,
    "volume": 23223.0
  },
  {
    "Unnamed: 0.1": 727,
    "Unnamed: 0": 919,
    "time": 1684355700,
    "open": 173.94,
    "high": 174.12,
    "low": 173.93,
    "close": 174.04,
    "volume": 20175.0
  },
  {
    "Unnamed: 0.1": 728,
    "Unnamed: 0": 920,
    "time": 1684356000,
    "open": 174.04,
    "high": 174.05,
    "low": 173.9,
    "close": 173.9,
    "volume": 15935.0
  },
  {
    "Unnamed: 0.1": 729,
    "Unnamed: 0": 921,
    "time": 1684356300,
    "open": 173.9,
    "high": 173.95,
    "low": 173.83,
    "close": 173.83,
    "volume": 16154.0
  },
  {
    "Unnamed: 0.1": 730,
    "Unnamed: 0": 922,
    "time": 1684356600,
    "open": 173.86,
    "high": 173.92,
    "low": 173.8,
    "close": 173.88,
    "volume": 14089.0
  },
  {
    "Unnamed: 0.1": 731,
    "Unnamed: 0": 923,
    "time": 1684356900,
    "open": 173.88,
    "high": 173.92,
    "low": 173.88,
    "close": 173.92,
    "volume": 16345.0
  },
  {
    "Unnamed: 0.1": 732,
    "Unnamed: 0": 924,
    "time": 1684357200,
    "open": 173.92,
    "high": 173.97,
    "low": 173.91,
    "close": 173.96,
    "volume": 5963.0
  },
  {
    "Unnamed: 0.1": 733,
    "Unnamed: 0": 925,
    "time": 1684357500,
    "open": 173.97,
    "high": 173.98,
    "low": 173.95,
    "close": 173.97,
    "volume": 3216.0
  },
  {
    "Unnamed: 0.1": 734,
    "Unnamed: 0": 926,
    "time": 1684357800,
    "open": 174.0,
    "high": 174.0,
    "low": 173.86,
    "close": 173.97,
    "volume": 11031.0
  },
  {
    "Unnamed: 0.1": 735,
    "Unnamed: 0": 927,
    "time": 1684358100,
    "open": 173.92,
    "high": 173.93,
    "low": 173.88,
    "close": 173.93,
    "volume": 13774.0
  },
  {
    "Unnamed: 0.1": 736,
    "Unnamed: 0": 928,
    "time": 1684358400,
    "open": 173.92,
    "high": 173.94,
    "low": 173.9,
    "close": 173.93,
    "volume": 3954.0
  },
  {
    "Unnamed: 0.1": 737,
    "Unnamed: 0": 929,
    "time": 1684358700,
    "open": 173.95,
    "high": 174.0,
    "low": 173.92,
    "close": 173.95,
    "volume": 9308.0
  },
  {
    "Unnamed: 0.1": 738,
    "Unnamed: 0": 930,
    "time": 1684359000,
    "open": 173.96,
    "high": 173.98,
    "low": 173.93,
    "close": 173.96,
    "volume": 3773.0
  },
  {
    "Unnamed: 0.1": 739,
    "Unnamed: 0": 931,
    "time": 1684359300,
    "open": 173.96,
    "high": 173.97,
    "low": 173.93,
    "close": 173.93,
    "volume": 5878.0
  },
  {
    "Unnamed: 0.1": 740,
    "Unnamed: 0": 932,
    "time": 1684359600,
    "open": 173.93,
    "high": 173.95,
    "low": 173.8,
    "close": 173.88,
    "volume": 12007.0
  },
  {
    "Unnamed: 0.1": 741,
    "Unnamed: 0": 933,
    "time": 1684359900,
    "open": 173.88,
    "high": 173.89,
    "low": 173.82,
    "close": 173.88,
    "volume": 10480.0
  },
  {
    "Unnamed: 0.1": 742,
    "Unnamed: 0": 934,
    "time": 1684360200,
    "open": 173.86,
    "high": 173.89,
    "low": 173.86,
    "close": 173.88,
    "volume": 4880.0
  },
  {
    "Unnamed: 0.1": 743,
    "Unnamed: 0": 935,
    "time": 1684360500,
    "open": 173.87,
    "high": 173.88,
    "low": 173.83,
    "close": 173.83,
    "volume": 6552.0
  },
  {
    "Unnamed: 0.1": 744,
    "Unnamed: 0": 936,
    "time": 1684360800,
    "open": 173.83,
    "high": 173.85,
    "low": 173.82,
    "close": 173.83,
    "volume": 11787.0
  },
  {
    "Unnamed: 0.1": 745,
    "Unnamed: 0": 937,
    "time": 1684361100,
    "open": 173.82,
    "high": 173.84,
    "low": 173.8,
    "close": 173.83,
    "volume": 15206.0
  },
  {
    "Unnamed: 0.1": 746,
    "Unnamed: 0": 938,
    "time": 1684361400,
    "open": 173.83,
    "high": 173.84,
    "low": 173.76,
    "close": 173.76,
    "volume": 18374.0
  },
  {
    "Unnamed: 0.1": 747,
    "Unnamed: 0": 939,
    "time": 1684361700,
    "open": 173.76,
    "high": 173.82,
    "low": 173.76,
    "close": 173.82,
    "volume": 2131.0
  },
  {
    "Unnamed: 0.1": 748,
    "Unnamed: 0": 940,
    "time": 1684362000,
    "open": 173.81,
    "high": 173.84,
    "low": 173.76,
    "close": 173.79,
    "volume": 8059.0
  },
  {
    "Unnamed: 0.1": 749,
    "Unnamed: 0": 941,
    "time": 1684362300,
    "open": 173.79,
    "high": 173.82,
    "low": 173.78,
    "close": 173.78,
    "volume": 2573.0
  },
  {
    "Unnamed: 0.1": 750,
    "Unnamed: 0": 942,
    "time": 1684362600,
    "open": 173.81,
    "high": 173.87,
    "low": 173.81,
    "close": 173.87,
    "volume": 7128.0
  },
  {
    "Unnamed: 0.1": 751,
    "Unnamed: 0": 943,
    "time": 1684362900,
    "open": 173.83,
    "high": 173.84,
    "low": 173.81,
    "close": 173.83,
    "volume": 9358.0
  },
  {
    "Unnamed: 0.1": 752,
    "Unnamed: 0": 944,
    "time": 1684363200,
    "open": 173.83,
    "high": 173.83,
    "low": 173.77,
    "close": 173.78,
    "volume": 10285.0
  },
  {
    "Unnamed: 0.1": 753,
    "Unnamed: 0": 945,
    "time": 1684363500,
    "open": 173.83,
    "high": 173.86,
    "low": 173.79,
    "close": 173.86,
    "volume": 5355.0
  },
  {
    "Unnamed: 0.1": 754,
    "Unnamed: 0": 946,
    "time": 1684363800,
    "open": 173.87,
    "high": 173.9,
    "low": 173.84,
    "close": 173.87,
    "volume": 8443.0
  },
  {
    "Unnamed: 0.1": 755,
    "Unnamed: 0": 947,
    "time": 1684364100,
    "open": 173.92,
    "high": 173.93,
    "low": 173.87,
    "close": 173.92,
    "volume": 7631.0
  },
  {
    "Unnamed: 0.1": 756,
    "Unnamed: 0": 948,
    "time": 1684364400,
    "open": 173.92,
    "high": 173.92,
    "low": 173.86,
    "close": 173.9,
    "volume": 4598.0
  },
  {
    "Unnamed: 0.1": 757,
    "Unnamed: 0": 949,
    "time": 1684364700,
    "open": 173.88,
    "high": 173.9,
    "low": 173.86,
    "close": 173.9,
    "volume": 4738.0
  },
  {
    "Unnamed: 0.1": 758,
    "Unnamed: 0": 950,
    "time": 1684365000,
    "open": 173.92,
    "high": 173.92,
    "low": 173.89,
    "close": 173.92,
    "volume": 4345.0
  },
  {
    "Unnamed: 0.1": 759,
    "Unnamed: 0": 951,
    "time": 1684365300,
    "open": 173.9,
    "high": 173.93,
    "low": 173.89,
    "close": 173.92,
    "volume": 6913.0
  },
  {
    "Unnamed: 0.1": 760,
    "Unnamed: 0": 952,
    "time": 1684365600,
    "open": 173.96,
    "high": 173.99,
    "low": 173.91,
    "close": 173.97,
    "volume": 4873.0
  },
  {
    "Unnamed: 0.1": 761,
    "Unnamed: 0": 953,
    "time": 1684365900,
    "open": 173.98,
    "high": 173.98,
    "low": 173.92,
    "close": 173.94,
    "volume": 4930.0
  },
  {
    "Unnamed: 0.1": 762,
    "Unnamed: 0": 954,
    "time": 1684366200,
    "open": 173.95,
    "high": 173.98,
    "low": 173.95,
    "close": 173.98,
    "volume": 8378.0
  },
  {
    "Unnamed: 0.1": 763,
    "Unnamed: 0": 955,
    "time": 1684366500,
    "open": 173.98,
    "high": 173.98,
    "low": 173.95,
    "close": 173.95,
    "volume": 4144.0
  },
  {
    "Unnamed: 0.1": 764,
    "Unnamed: 0": 956,
    "time": 1684366800,
    "open": 173.95,
    "high": 173.98,
    "low": 173.95,
    "close": 173.98,
    "volume": 4114.0
  },
  {
    "Unnamed: 0.1": 765,
    "Unnamed: 0": 957,
    "time": 1684367100,
    "open": 173.96,
    "high": 173.98,
    "low": 173.95,
    "close": 173.98,
    "volume": 10147.0
  },
  {
    "Unnamed: 0.1": 766,
    "Unnamed: 0": 958,
    "time": 1684367400,
    "open": 173.98,
    "high": 173.99,
    "low": 173.96,
    "close": 173.98,
    "volume": 9021.0
  },
  {
    "Unnamed: 0.1": 767,
    "Unnamed: 0": 959,
    "time": 1684367700,
    "open": 173.99,
    "high": 174.13,
    "low": 173.96,
    "close": 174.1,
    "volume": 45786.0
  },
  {
    "Unnamed: 0.1": 768,
    "Unnamed: 0": 960,
    "time": 1684396800,
    "open": 174.15,
    "high": 174.7,
    "low": 173.72,
    "close": 174.57,
    "volume": 8324.0
  },
  {
    "Unnamed: 0.1": 769,
    "Unnamed: 0": 961,
    "time": 1684397100,
    "open": 174.69,
    "high": 174.98,
    "low": 174.68,
    "close": 174.94,
    "volume": 11595.0
  },
  {
    "Unnamed: 0.1": 770,
    "Unnamed: 0": 962,
    "time": 1684397400,
    "open": 174.94,
    "high": 175.0,
    "low": 174.88,
    "close": 174.88,
    "volume": 5772.0
  },
  {
    "Unnamed: 0.1": 771,
    "Unnamed: 0": 963,
    "time": 1684397700,
    "open": 174.89,
    "high": 174.89,
    "low": 174.8,
    "close": 174.81,
    "volume": 4714.0
  },
  {
    "Unnamed: 0.1": 772,
    "Unnamed: 0": 964,
    "time": 1684398000,
    "open": 174.82,
    "high": 174.82,
    "low": 174.74,
    "close": 174.82,
    "volume": 6690.0
  },
  {
    "Unnamed: 0.1": 773,
    "Unnamed: 0": 965,
    "time": 1684398300,
    "open": 174.82,
    "high": 174.85,
    "low": 174.76,
    "close": 174.85,
    "volume": 3797.0
  },
  {
    "Unnamed: 0.1": 774,
    "Unnamed: 0": 966,
    "time": 1684398600,
    "open": 174.78,
    "high": 174.9,
    "low": 174.78,
    "close": 174.9,
    "volume": 1607.0
  },
  {
    "Unnamed: 0.1": 775,
    "Unnamed: 0": 967,
    "time": 1684398900,
    "open": 174.85,
    "high": 174.86,
    "low": 174.82,
    "close": 174.82,
    "volume": 529.0
  },
  {
    "Unnamed: 0.1": 776,
    "Unnamed: 0": 968,
    "time": 1684399200,
    "open": 174.77,
    "high": 174.84,
    "low": 174.77,
    "close": 174.84,
    "volume": 895.0
  },
  {
    "Unnamed: 0.1": 777,
    "Unnamed: 0": 969,
    "time": 1684399500,
    "open": 174.9,
    "high": 174.96,
    "low": 174.9,
    "close": 174.96,
    "volume": 500.0
  },
  {
    "Unnamed: 0.1": 778,
    "Unnamed: 0": 970,
    "time": 1684399800,
    "open": 174.9,
    "high": 174.97,
    "low": 174.9,
    "close": 174.92,
    "volume": 1700.0
  },
  {
    "Unnamed: 0.1": 779,
    "Unnamed: 0": 971,
    "time": 1684400100,
    "open": 174.95,
    "high": 174.95,
    "low": 174.9,
    "close": 174.9,
    "volume": 566.0
  },
  {
    "Unnamed: 0.1": 780,
    "Unnamed: 0": 972,
    "time": 1684400400,
    "open": 174.93,
    "high": 174.93,
    "low": 174.76,
    "close": 174.84,
    "volume": 2563.0
  },
  {
    "Unnamed: 0.1": 781,
    "Unnamed: 0": 973,
    "time": 1684400700,
    "open": 174.9,
    "high": 174.9,
    "low": 174.85,
    "close": 174.86,
    "volume": 2097.0
  },
  {
    "Unnamed: 0.1": 782,
    "Unnamed: 0": 974,
    "time": 1684401000,
    "open": 174.9,
    "high": 174.9,
    "low": 174.9,
    "close": 174.9,
    "volume": 936.0
  },
  {
    "Unnamed: 0.1": 783,
    "Unnamed: 0": 975,
    "time": 1684401300,
    "open": 174.87,
    "high": 174.89,
    "low": 174.87,
    "close": 174.89,
    "volume": 700.0
  },
  {
    "Unnamed: 0.1": 784,
    "Unnamed: 0": 976,
    "time": 1684401600,
    "open": 174.87,
    "high": 174.93,
    "low": 174.85,
    "close": 174.85,
    "volume": 2137.0
  },
  {
    "Unnamed: 0.1": 785,
    "Unnamed: 0": 977,
    "time": 1684401900,
    "open": 174.89,
    "high": 174.92,
    "low": 174.89,
    "close": 174.92,
    "volume": 599.0
  },
  {
    "Unnamed: 0.1": 786,
    "Unnamed: 0": 978,
    "time": 1684402200,
    "open": 174.92,
    "high": 174.92,
    "low": 174.77,
    "close": 174.89,
    "volume": 4087.0
  },
  {
    "Unnamed: 0.1": 787,
    "Unnamed: 0": 979,
    "time": 1684402500,
    "open": 174.89,
    "high": 174.9,
    "low": 174.81,
    "close": 174.81,
    "volume": 1755.0
  },
  {
    "Unnamed: 0.1": 788,
    "Unnamed: 0": 980,
    "time": 1684402800,
    "open": 174.81,
    "high": 174.88,
    "low": 174.81,
    "close": 174.88,
    "volume": 303.0
  },
  {
    "Unnamed: 0.1": 789,
    "Unnamed: 0": 981,
    "time": 1684403100,
    "open": 174.88,
    "high": 174.9,
    "low": 174.87,
    "close": 174.88,
    "volume": 3661.0
  },
  {
    "Unnamed: 0.1": 790,
    "Unnamed: 0": 982,
    "time": 1684403400,
    "open": 174.89,
    "high": 174.98,
    "low": 174.89,
    "close": 174.98,
    "volume": 1121.0
  },
  {
    "Unnamed: 0.1": 791,
    "Unnamed: 0": 983,
    "time": 1684403700,
    "open": 174.98,
    "high": 175.48,
    "low": 174.98,
    "close": 175.33,
    "volume": 20785.0
  },
  {
    "Unnamed: 0.1": 792,
    "Unnamed: 0": 984,
    "time": 1684404000,
    "open": 175.3,
    "high": 175.44,
    "low": 175.22,
    "close": 175.4,
    "volume": 3160.0
  },
  {
    "Unnamed: 0.1": 793,
    "Unnamed: 0": 985,
    "time": 1684404300,
    "open": 175.44,
    "high": 175.44,
    "low": 175.3,
    "close": 175.3,
    "volume": 1511.0
  },
  {
    "Unnamed: 0.1": 794,
    "Unnamed: 0": 986,
    "time": 1684404600,
    "open": 175.4,
    "high": 175.42,
    "low": 175.4,
    "close": 175.42,
    "volume": 680.0
  },
  {
    "Unnamed: 0.1": 795,
    "Unnamed: 0": 987,
    "time": 1684404900,
    "open": 175.45,
    "high": 175.47,
    "low": 175.43,
    "close": 175.46,
    "volume": 2187.0
  },
  {
    "Unnamed: 0.1": 796,
    "Unnamed: 0": 988,
    "time": 1684405200,
    "open": 175.47,
    "high": 175.47,
    "low": 175.41,
    "close": 175.41,
    "volume": 1149.0
  },
  {
    "Unnamed: 0.1": 797,
    "Unnamed: 0": 989,
    "time": 1684405500,
    "open": 175.4,
    "high": 175.4,
    "low": 175.24,
    "close": 175.29,
    "volume": 2513.0
  },
  {
    "Unnamed: 0.1": 798,
    "Unnamed: 0": 990,
    "time": 1684405800,
    "open": 175.3,
    "high": 175.33,
    "low": 175.24,
    "close": 175.31,
    "volume": 2393.0
  },
  {
    "Unnamed: 0.1": 799,
    "Unnamed: 0": 991,
    "time": 1684406100,
    "open": 175.3,
    "high": 175.38,
    "low": 175.28,
    "close": 175.38,
    "volume": 2742.0
  },
  {
    "Unnamed: 0.1": 800,
    "Unnamed: 0": 992,
    "time": 1684406400,
    "open": 175.4,
    "high": 175.41,
    "low": 175.39,
    "close": 175.39,
    "volume": 1900.0
  },
  {
    "Unnamed: 0.1": 801,
    "Unnamed: 0": 993,
    "time": 1684406700,
    "open": 175.39,
    "high": 175.47,
    "low": 175.39,
    "close": 175.47,
    "volume": 2141.0
  },
  {
    "Unnamed: 0.1": 802,
    "Unnamed: 0": 994,
    "time": 1684407000,
    "open": 175.49,
    "high": 175.49,
    "low": 175.43,
    "close": 175.49,
    "volume": 1752.0
  },
  {
    "Unnamed: 0.1": 803,
    "Unnamed: 0": 995,
    "time": 1684407300,
    "open": 175.42,
    "high": 175.71,
    "low": 175.4,
    "close": 175.68,
    "volume": 16114.0
  },
  {
    "Unnamed: 0.1": 804,
    "Unnamed: 0": 996,
    "time": 1684407600,
    "open": 175.56,
    "high": 175.95,
    "low": 175.22,
    "close": 175.87,
    "volume": 58003.0
  },
  {
    "Unnamed: 0.1": 805,
    "Unnamed: 0": 997,
    "time": 1684407900,
    "open": 175.9,
    "high": 176.13,
    "low": 175.65,
    "close": 175.75,
    "volume": 62014.0
  },
  {
    "Unnamed: 0.1": 806,
    "Unnamed: 0": 998,
    "time": 1684408200,
    "open": 175.77,
    "high": 175.8,
    "low": 175.63,
    "close": 175.69,
    "volume": 15824.0
  },
  {
    "Unnamed: 0.1": 807,
    "Unnamed: 0": 999,
    "time": 1684408500,
    "open": 175.68,
    "high": 175.89,
    "low": 175.66,
    "close": 175.83,
    "volume": 19799.0
  },
  {
    "Unnamed: 0.1": 808,
    "Unnamed: 0": 1000,
    "time": 1684408800,
    "open": 175.84,
    "high": 175.89,
    "low": 175.75,
    "close": 175.8,
    "volume": 17814.0
  },
  {
    "Unnamed: 0.1": 809,
    "Unnamed: 0": 1001,
    "time": 1684409100,
    "open": 175.85,
    "high": 175.89,
    "low": 175.8,
    "close": 175.85,
    "volume": 7383.0
  },
  {
    "Unnamed: 0.1": 810,
    "Unnamed: 0": 1002,
    "time": 1684409400,
    "open": 175.85,
    "high": 175.89,
    "low": 175.73,
    "close": 175.77,
    "volume": 16917.0
  },
  {
    "Unnamed: 0.1": 811,
    "Unnamed: 0": 1003,
    "time": 1684409700,
    "open": 175.8,
    "high": 175.8,
    "low": 175.7,
    "close": 175.75,
    "volume": 8922.0
  },
  {
    "Unnamed: 0.1": 812,
    "Unnamed: 0": 1004,
    "time": 1684410000,
    "open": 175.72,
    "high": 175.85,
    "low": 175.72,
    "close": 175.75,
    "volume": 7478.0
  },
  {
    "Unnamed: 0.1": 813,
    "Unnamed: 0": 1005,
    "time": 1684410300,
    "open": 175.75,
    "high": 175.82,
    "low": 175.7,
    "close": 175.71,
    "volume": 8709.0
  },
  {
    "Unnamed: 0.1": 814,
    "Unnamed: 0": 1006,
    "time": 1684410600,
    "open": 175.7,
    "high": 175.72,
    "low": 175.65,
    "close": 175.65,
    "volume": 5574.0
  },
  {
    "Unnamed: 0.1": 815,
    "Unnamed: 0": 1007,
    "time": 1684410900,
    "open": 175.65,
    "high": 175.88,
    "low": 175.51,
    "close": 175.85,
    "volume": 18620.0
  },
  {
    "Unnamed: 0.1": 816,
    "Unnamed: 0": 1008,
    "time": 1684411200,
    "open": 175.53,
    "high": 176.14,
    "low": 173.5,
    "close": 175.51,
    "volume": 200096.0
  },
  {
    "Unnamed: 0.1": 817,
    "Unnamed: 0": 1009,
    "time": 1684411500,
    "open": 175.5,
    "high": 175.51,
    "low": 175.03,
    "close": 175.1,
    "volume": 63463.0
  },
  {
    "Unnamed: 0.1": 818,
    "Unnamed: 0": 1010,
    "time": 1684411800,
    "open": 175.08,
    "high": 175.43,
    "low": 175.04,
    "close": 175.25,
    "volume": 63234.0
  },
  {
    "Unnamed: 0.1": 819,
    "Unnamed: 0": 1011,
    "time": 1684412100,
    "open": 175.23,
    "high": 175.25,
    "low": 175.0,
    "close": 175.1,
    "volume": 64392.0
  },
  {
    "Unnamed: 0.1": 820,
    "Unnamed: 0": 1012,
    "time": 1684412400,
    "open": 175.1,
    "high": 175.29,
    "low": 175.01,
    "close": 175.28,
    "volume": 35241.0
  },
  {
    "Unnamed: 0.1": 821,
    "Unnamed: 0": 1013,
    "time": 1684412700,
    "open": 175.26,
    "high": 175.63,
    "low": 175.26,
    "close": 175.56,
    "volume": 61996.0
  },
  {
    "Unnamed: 0.1": 822,
    "Unnamed: 0": 1014,
    "time": 1684413000,
    "open": 175.56,
    "high": 175.69,
    "low": 175.18,
    "close": 175.18,
    "volume": 86791.0
  },
  {
    "Unnamed: 0.1": 823,
    "Unnamed: 0": 1015,
    "time": 1684413300,
    "open": 175.2,
    "high": 175.43,
    "low": 175.15,
    "close": 175.23,
    "volume": 34903.0
  },
  {
    "Unnamed: 0.1": 824,
    "Unnamed: 0": 1016,
    "time": 1684413600,
    "open": 175.24,
    "high": 175.44,
    "low": 175.19,
    "close": 175.37,
    "volume": 44046.0
  },
  {
    "Unnamed: 0.1": 825,
    "Unnamed: 0": 1017,
    "time": 1684413900,
    "open": 175.37,
    "high": 175.45,
    "low": 174.9,
    "close": 175.0,
    "volume": 43765.0
  },
  {
    "Unnamed: 0.1": 826,
    "Unnamed: 0": 1018,
    "time": 1684414200,
    "open": 174.99,
    "high": 175.06,
    "low": 174.12,
    "close": 174.39,
    "volume": 150616.0
  },
  {
    "Unnamed: 0.1": 827,
    "Unnamed: 0": 1019,
    "time": 1684414500,
    "open": 174.39,
    "high": 174.43,
    "low": 174.0,
    "close": 174.23,
    "volume": 92190.0
  },
  {
    "Unnamed: 0.1": 828,
    "Unnamed: 0": 1020,
    "time": 1684414800,
    "open": 174.2,
    "high": 174.59,
    "low": 174.14,
    "close": 174.39,
    "volume": 87797.0
  },
  {
    "Unnamed: 0.1": 829,
    "Unnamed: 0": 1021,
    "time": 1684415100,
    "open": 174.41,
    "high": 174.52,
    "low": 174.2,
    "close": 174.5,
    "volume": 73437.0
  },
  {
    "Unnamed: 0.1": 830,
    "Unnamed: 0": 1022,
    "time": 1684415400,
    "open": 174.5,
    "high": 174.81,
    "low": 174.45,
    "close": 174.68,
    "volume": 75807.0
  },
  {
    "Unnamed: 0.1": 831,
    "Unnamed: 0": 1023,
    "time": 1684415700,
    "open": 174.62,
    "high": 174.75,
    "low": 174.4,
    "close": 174.67,
    "volume": 47777.0
  },
  {
    "Unnamed: 0.1": 832,
    "Unnamed: 0": 1024,
    "time": 1684416000,
    "open": 174.7,
    "high": 174.7,
    "low": 174.48,
    "close": 174.48,
    "volume": 38932.0
  },
  {
    "Unnamed: 0.1": 833,
    "Unnamed: 0": 1025,
    "time": 1684416300,
    "open": 174.6,
    "high": 174.62,
    "low": 174.17,
    "close": 174.29,
    "volume": 43303.0
  },
  {
    "Unnamed: 0.1": 834,
    "Unnamed: 0": 1026,
    "time": 1684416600,
    "open": 174.29,
    "high": 174.8,
    "low": 173.24,
    "close": 174.02,
    "volume": 3514968.0
  },
  {
    "Unnamed: 0.1": 835,
    "Unnamed: 0": 1027,
    "time": 1684416900,
    "open": 174.05,
    "high": 174.65,
    "low": 173.2,
    "close": 174.37,
    "volume": 3270920.0
  },
  {
    "Unnamed: 0.1": 836,
    "Unnamed: 0": 1028,
    "time": 1684417200,
    "open": 174.35,
    "high": 174.94,
    "low": 173.41,
    "close": 173.67,
    "volume": 2908935.0
  },
  {
    "Unnamed: 0.1": 837,
    "Unnamed: 0": 1029,
    "time": 1684417500,
    "open": 173.64,
    "high": 174.32,
    "low": 173.39,
    "close": 173.43,
    "volume": 2092070.0
  },
  {
    "Unnamed: 0.1": 838,
    "Unnamed: 0": 1030,
    "time": 1684417800,
    "open": 173.42,
    "high": 173.5,
    "low": 172.63,
    "close": 173.08,
    "volume": 2432506.0
  },
  {
    "Unnamed: 0.1": 839,
    "Unnamed: 0": 1031,
    "time": 1684418100,
    "open": 173.08,
    "high": 173.59,
    "low": 172.8,
    "close": 173.36,
    "volume": 1782370.0
  },
  {
    "Unnamed: 0.1": 840,
    "Unnamed: 0": 1032,
    "time": 1684418400,
    "open": 173.36,
    "high": 173.46,
    "low": 172.49,
    "close": 172.65,
    "volume": 1692163.0
  },
  {
    "Unnamed: 0.1": 841,
    "Unnamed: 0": 1033,
    "time": 1684418700,
    "open": 172.65,
    "high": 173.28,
    "low": 172.45,
    "close": 173.09,
    "volume": 1535773.0
  },
  {
    "Unnamed: 0.1": 842,
    "Unnamed: 0": 1034,
    "time": 1684419000,
    "open": 173.06,
    "high": 173.68,
    "low": 173.06,
    "close": 173.6,
    "volume": 1534923.0
  },
  {
    "Unnamed: 0.1": 843,
    "Unnamed: 0": 1035,
    "time": 1684419300,
    "open": 173.6,
    "high": 174.68,
    "low": 173.49,
    "close": 174.48,
    "volume": 2094809.0
  },
  {
    "Unnamed: 0.1": 844,
    "Unnamed: 0": 1036,
    "time": 1684419600,
    "open": 174.49,
    "high": 175.43,
    "low": 174.48,
    "close": 175.01,
    "volume": 2508478.0
  },
  {
    "Unnamed: 0.1": 845,
    "Unnamed: 0": 1037,
    "time": 1684419900,
    "open": 175.01,
    "high": 175.6,
    "low": 174.9,
    "close": 175.03,
    "volume": 2030405.0
  },
  {
    "Unnamed: 0.1": 846,
    "Unnamed: 0": 1038,
    "time": 1684420200,
    "open": 175.04,
    "high": 175.42,
    "low": 174.61,
    "close": 174.84,
    "volume": 1803855.0
  },
  {
    "Unnamed: 0.1": 847,
    "Unnamed: 0": 1039,
    "time": 1684420500,
    "open": 174.84,
    "high": 174.9,
    "low": 174.02,
    "close": 174.42,
    "volume": 1629094.0
  },
  {
    "Unnamed: 0.1": 848,
    "Unnamed: 0": 1040,
    "time": 1684420800,
    "open": 174.43,
    "high": 174.43,
    "low": 173.63,
    "close": 173.75,
    "volume": 1358540.0
  },
  {
    "Unnamed: 0.1": 849,
    "Unnamed: 0": 1041,
    "time": 1684421100,
    "open": 173.74,
    "high": 174.03,
    "low": 173.43,
    "close": 173.89,
    "volume": 1478732.0
  },
  {
    "Unnamed: 0.1": 850,
    "Unnamed: 0": 1042,
    "time": 1684421400,
    "open": 173.87,
    "high": 174.18,
    "low": 173.62,
    "close": 173.85,
    "volume": 1149048.0
  },
  {
    "Unnamed: 0.1": 851,
    "Unnamed: 0": 1043,
    "time": 1684421700,
    "open": 173.86,
    "high": 174.42,
    "low": 173.79,
    "close": 174.36,
    "volume": 1063204.0
  },
  {
    "Unnamed: 0.1": 852,
    "Unnamed: 0": 1044,
    "time": 1684422000,
    "open": 174.37,
    "high": 174.8,
    "low": 174.22,
    "close": 174.67,
    "volume": 1138933.0
  },
  {
    "Unnamed: 0.1": 853,
    "Unnamed: 0": 1045,
    "time": 1684422300,
    "open": 174.65,
    "high": 175.1,
    "low": 174.54,
    "close": 175.09,
    "volume": 1323973.0
  },
  {
    "Unnamed: 0.1": 854,
    "Unnamed: 0": 1046,
    "time": 1684422600,
    "open": 175.08,
    "high": 175.16,
    "low": 174.91,
    "close": 174.99,
    "volume": 1069171.0
  },
  {
    "Unnamed: 0.1": 855,
    "Unnamed: 0": 1047,
    "time": 1684422900,
    "open": 175.0,
    "high": 175.37,
    "low": 174.95,
    "close": 175.11,
    "volume": 1056949.0
  },
  {
    "Unnamed: 0.1": 856,
    "Unnamed: 0": 1048,
    "time": 1684423200,
    "open": 175.12,
    "high": 175.28,
    "low": 174.87,
    "close": 175.1,
    "volume": 854219.0
  },
  {
    "Unnamed: 0.1": 857,
    "Unnamed: 0": 1049,
    "time": 1684423500,
    "open": 175.1,
    "high": 175.52,
    "low": 174.81,
    "close": 174.91,
    "volume": 1380923.0
  },
  {
    "Unnamed: 0.1": 858,
    "Unnamed: 0": 1050,
    "time": 1684423800,
    "open": 174.91,
    "high": 174.97,
    "low": 174.31,
    "close": 174.54,
    "volume": 1329295.0
  },
  {
    "Unnamed: 0.1": 859,
    "Unnamed: 0": 1051,
    "time": 1684424100,
    "open": 174.55,
    "high": 175.33,
    "low": 174.43,
    "close": 175.19,
    "volume": 1204080.0
  },
  {
    "Unnamed: 0.1": 860,
    "Unnamed: 0": 1052,
    "time": 1684424400,
    "open": 175.21,
    "high": 175.38,
    "low": 175.06,
    "close": 175.21,
    "volume": 781697.0
  },
  {
    "Unnamed: 0.1": 861,
    "Unnamed: 0": 1053,
    "time": 1684424700,
    "open": 175.2,
    "high": 175.53,
    "low": 175.15,
    "close": 175.2,
    "volume": 984477.0
  },
  {
    "Unnamed: 0.1": 862,
    "Unnamed: 0": 1054,
    "time": 1684425000,
    "open": 175.21,
    "high": 175.75,
    "low": 175.11,
    "close": 175.34,
    "volume": 1278577.0
  },
  {
    "Unnamed: 0.1": 863,
    "Unnamed: 0": 1055,
    "time": 1684425300,
    "open": 175.33,
    "high": 175.46,
    "low": 174.85,
    "close": 175.06,
    "volume": 1110620.0
  },
  {
    "Unnamed: 0.1": 864,
    "Unnamed: 0": 1056,
    "time": 1684425600,
    "open": 175.05,
    "high": 175.2,
    "low": 174.95,
    "close": 175.05,
    "volume": 784523.0
  },
  {
    "Unnamed: 0.1": 865,
    "Unnamed: 0": 1057,
    "time": 1684425900,
    "open": 175.05,
    "high": 175.1,
    "low": 174.56,
    "close": 174.87,
    "volume": 1097927.0
  },
  {
    "Unnamed: 0.1": 866,
    "Unnamed: 0": 1058,
    "time": 1684426200,
    "open": 174.87,
    "high": 175.12,
    "low": 174.33,
    "close": 174.37,
    "volume": 947748.0
  },
  {
    "Unnamed: 0.1": 867,
    "Unnamed: 0": 1059,
    "time": 1684426500,
    "open": 174.35,
    "high": 174.92,
    "low": 174.21,
    "close": 174.78,
    "volume": 867325.0
  },
  {
    "Unnamed: 0.1": 868,
    "Unnamed: 0": 1060,
    "time": 1684426800,
    "open": 174.79,
    "high": 174.83,
    "low": 174.5,
    "close": 174.65,
    "volume": 707158.0
  },
  {
    "Unnamed: 0.1": 869,
    "Unnamed: 0": 1061,
    "time": 1684427100,
    "open": 174.62,
    "high": 174.7,
    "low": 174.14,
    "close": 174.41,
    "volume": 857784.0
  },
  {
    "Unnamed: 0.1": 870,
    "Unnamed: 0": 1062,
    "time": 1684427400,
    "open": 174.38,
    "high": 174.93,
    "low": 174.33,
    "close": 174.89,
    "volume": 802604.0
  },
  {
    "Unnamed: 0.1": 871,
    "Unnamed: 0": 1063,
    "time": 1684427700,
    "open": 174.88,
    "high": 174.89,
    "low": 174.37,
    "close": 174.58,
    "volume": 885123.0
  },
  {
    "Unnamed: 0.1": 872,
    "Unnamed: 0": 1064,
    "time": 1684428000,
    "open": 174.57,
    "high": 174.63,
    "low": 174.15,
    "close": 174.44,
    "volume": 776585.0
  },
  {
    "Unnamed: 0.1": 873,
    "Unnamed: 0": 1065,
    "time": 1684428300,
    "open": 174.42,
    "high": 174.54,
    "low": 173.89,
    "close": 174.21,
    "volume": 1046430.0
  },
  {
    "Unnamed: 0.1": 874,
    "Unnamed: 0": 1066,
    "time": 1684428600,
    "open": 174.2,
    "high": 174.5,
    "low": 174.1,
    "close": 174.41,
    "volume": 869964.0
  },
  {
    "Unnamed: 0.1": 875,
    "Unnamed: 0": 1067,
    "time": 1684428900,
    "open": 174.45,
    "high": 174.71,
    "low": 174.15,
    "close": 174.66,
    "volume": 731636.0
  },
  {
    "Unnamed: 0.1": 876,
    "Unnamed: 0": 1068,
    "time": 1684429200,
    "open": 174.66,
    "high": 174.92,
    "low": 174.59,
    "close": 174.75,
    "volume": 700337.0
  },
  {
    "Unnamed: 0.1": 877,
    "Unnamed: 0": 1069,
    "time": 1684429500,
    "open": 174.76,
    "high": 174.86,
    "low": 174.61,
    "close": 174.81,
    "volume": 511099.0
  },
  {
    "Unnamed: 0.1": 878,
    "Unnamed: 0": 1070,
    "time": 1684429800,
    "open": 174.8,
    "high": 174.88,
    "low": 174.54,
    "close": 174.61,
    "volume": 580186.0
  },
  {
    "Unnamed: 0.1": 879,
    "Unnamed: 0": 1071,
    "time": 1684430100,
    "open": 174.6,
    "high": 175.14,
    "low": 174.59,
    "close": 175.06,
    "volume": 821861.0
  },
  {
    "Unnamed: 0.1": 880,
    "Unnamed: 0": 1072,
    "time": 1684430400,
    "open": 175.06,
    "high": 175.38,
    "low": 175.05,
    "close": 175.25,
    "volume": 828124.0
  },
  {
    "Unnamed: 0.1": 881,
    "Unnamed: 0": 1073,
    "time": 1684430700,
    "open": 175.26,
    "high": 175.52,
    "low": 174.95,
    "close": 175.13,
    "volume": 1099719.0
  },
  {
    "Unnamed: 0.1": 882,
    "Unnamed: 0": 1074,
    "time": 1684431000,
    "open": 175.14,
    "high": 175.48,
    "low": 175.01,
    "close": 175.33,
    "volume": 647871.0
  },
  {
    "Unnamed: 0.1": 883,
    "Unnamed: 0": 1075,
    "time": 1684431300,
    "open": 175.33,
    "high": 175.41,
    "low": 174.93,
    "close": 174.96,
    "volume": 538687.0
  },
  {
    "Unnamed: 0.1": 884,
    "Unnamed: 0": 1076,
    "time": 1684431600,
    "open": 174.98,
    "high": 175.17,
    "low": 174.9,
    "close": 174.95,
    "volume": 612662.0
  },
  {
    "Unnamed: 0.1": 885,
    "Unnamed: 0": 1077,
    "time": 1684431900,
    "open": 174.96,
    "high": 175.2,
    "low": 174.73,
    "close": 175.15,
    "volume": 704570.0
  },
  {
    "Unnamed: 0.1": 886,
    "Unnamed: 0": 1078,
    "time": 1684432200,
    "open": 175.15,
    "high": 175.23,
    "low": 174.85,
    "close": 174.97,
    "volume": 473376.0
  },
  {
    "Unnamed: 0.1": 887,
    "Unnamed: 0": 1079,
    "time": 1684432500,
    "open": 174.96,
    "high": 175.0,
    "low": 174.59,
    "close": 174.71,
    "volume": 592400.0
  },
  {
    "Unnamed: 0.1": 888,
    "Unnamed: 0": 1080,
    "time": 1684432800,
    "open": 174.7,
    "high": 174.74,
    "low": 174.31,
    "close": 174.52,
    "volume": 823361.0
  },
  {
    "Unnamed: 0.1": 889,
    "Unnamed: 0": 1081,
    "time": 1684433100,
    "open": 174.5,
    "high": 174.54,
    "low": 174.22,
    "close": 174.3,
    "volume": 711214.0
  },
  {
    "Unnamed: 0.1": 890,
    "Unnamed: 0": 1082,
    "time": 1684433400,
    "open": 174.3,
    "high": 174.47,
    "low": 174.09,
    "close": 174.33,
    "volume": 706974.0
  },
  {
    "Unnamed: 0.1": 891,
    "Unnamed: 0": 1083,
    "time": 1684433700,
    "open": 174.33,
    "high": 174.66,
    "low": 174.24,
    "close": 174.63,
    "volume": 547299.0
  },
  {
    "Unnamed: 0.1": 892,
    "Unnamed: 0": 1084,
    "time": 1684434000,
    "open": 174.62,
    "high": 174.85,
    "low": 174.49,
    "close": 174.83,
    "volume": 675020.0
  },
  {
    "Unnamed: 0.1": 893,
    "Unnamed: 0": 1085,
    "time": 1684434300,
    "open": 174.83,
    "high": 175.03,
    "low": 174.82,
    "close": 174.87,
    "volume": 671612.0
  },
  {
    "Unnamed: 0.1": 894,
    "Unnamed: 0": 1086,
    "time": 1684434600,
    "open": 174.88,
    "high": 175.2,
    "low": 174.87,
    "close": 175.1,
    "volume": 664912.0
  },
  {
    "Unnamed: 0.1": 895,
    "Unnamed: 0": 1087,
    "time": 1684434900,
    "open": 175.11,
    "high": 175.12,
    "low": 174.96,
    "close": 175.08,
    "volume": 498966.0
  },
  {
    "Unnamed: 0.1": 896,
    "Unnamed: 0": 1088,
    "time": 1684435200,
    "open": 175.09,
    "high": 175.34,
    "low": 174.81,
    "close": 175.14,
    "volume": 984186.0
  },
  {
    "Unnamed: 0.1": 897,
    "Unnamed: 0": 1089,
    "time": 1684435500,
    "open": 175.13,
    "high": 175.35,
    "low": 175.03,
    "close": 175.25,
    "volume": 662732.0
  },
  {
    "Unnamed: 0.1": 898,
    "Unnamed: 0": 1090,
    "time": 1684435800,
    "open": 175.27,
    "high": 175.34,
    "low": 175.04,
    "close": 175.04,
    "volume": 552146.0
  },
  {
    "Unnamed: 0.1": 899,
    "Unnamed: 0": 1091,
    "time": 1684436100,
    "open": 175.04,
    "high": 175.26,
    "low": 175.0,
    "close": 175.25,
    "volume": 489129.0
  },
  {
    "Unnamed: 0.1": 900,
    "Unnamed: 0": 1092,
    "time": 1684436400,
    "open": 175.25,
    "high": 175.34,
    "low": 175.11,
    "close": 175.18,
    "volume": 601242.0
  },
  {
    "Unnamed: 0.1": 901,
    "Unnamed: 0": 1093,
    "time": 1684436700,
    "open": 175.18,
    "high": 175.29,
    "low": 175.11,
    "close": 175.23,
    "volume": 423555.0
  },
  {
    "Unnamed: 0.1": 902,
    "Unnamed: 0": 1094,
    "time": 1684437000,
    "open": 175.22,
    "high": 175.99,
    "low": 175.22,
    "close": 175.79,
    "volume": 1707537.0
  },
  {
    "Unnamed: 0.1": 903,
    "Unnamed: 0": 1095,
    "time": 1684437300,
    "open": 175.78,
    "high": 176.29,
    "low": 175.71,
    "close": 176.16,
    "volume": 1111125.0
  },
  {
    "Unnamed: 0.1": 904,
    "Unnamed: 0": 1096,
    "time": 1684437600,
    "open": 176.16,
    "high": 176.28,
    "low": 175.77,
    "close": 175.86,
    "volume": 975745.0
  },
  {
    "Unnamed: 0.1": 905,
    "Unnamed: 0": 1097,
    "time": 1684437900,
    "open": 175.85,
    "high": 176.14,
    "low": 175.82,
    "close": 176.08,
    "volume": 688070.0
  },
  {
    "Unnamed: 0.1": 906,
    "Unnamed: 0": 1098,
    "time": 1684438200,
    "open": 176.09,
    "high": 176.47,
    "low": 175.95,
    "close": 176.4,
    "volume": 1073060.0
  },
  {
    "Unnamed: 0.1": 907,
    "Unnamed: 0": 1099,
    "time": 1684438500,
    "open": 176.41,
    "high": 176.49,
    "low": 176.16,
    "close": 176.24,
    "volume": 745812.0
  },
  {
    "Unnamed: 0.1": 908,
    "Unnamed: 0": 1100,
    "time": 1684438800,
    "open": 176.22,
    "high": 176.57,
    "low": 176.17,
    "close": 176.51,
    "volume": 1028588.0
  },
  {
    "Unnamed: 0.1": 909,
    "Unnamed: 0": 1101,
    "time": 1684439100,
    "open": 176.51,
    "high": 176.68,
    "low": 176.32,
    "close": 176.43,
    "volume": 960221.0
  },
  {
    "Unnamed: 0.1": 910,
    "Unnamed: 0": 1102,
    "time": 1684439400,
    "open": 176.43,
    "high": 176.59,
    "low": 176.31,
    "close": 176.45,
    "volume": 1232764.0
  },
  {
    "Unnamed: 0.1": 911,
    "Unnamed: 0": 1103,
    "time": 1684439700,
    "open": 176.46,
    "high": 177.06,
    "low": 176.36,
    "close": 176.9,
    "volume": 2348710.0
  },
  {
    "Unnamed: 0.1": 912,
    "Unnamed: 0": 1104,
    "time": 1684440000,
    "open": 176.91,
    "high": 177.15,
    "low": 176.88,
    "close": 176.88,
    "volume": 2255806.0
  },
  {
    "Unnamed: 0.1": 913,
    "Unnamed: 0": 1105,
    "time": 1684440300,
    "open": 176.87,
    "high": 176.93,
    "low": 176.6,
    "close": 176.74,
    "volume": 71629.0
  },
  {
    "Unnamed: 0.1": 914,
    "Unnamed: 0": 1106,
    "time": 1684440600,
    "open": 176.67,
    "high": 176.89,
    "low": 176.65,
    "close": 176.75,
    "volume": 31207.0
  },
  {
    "Unnamed: 0.1": 915,
    "Unnamed: 0": 1107,
    "time": 1684440900,
    "open": 176.75,
    "high": 176.85,
    "low": 176.72,
    "close": 176.8,
    "volume": 28740.0
  },
  {
    "Unnamed: 0.1": 916,
    "Unnamed: 0": 1108,
    "time": 1684441200,
    "open": 176.8,
    "high": 176.89,
    "low": 176.78,
    "close": 176.81,
    "volume": 17903.0
  },
  {
    "Unnamed: 0.1": 917,
    "Unnamed: 0": 1109,
    "time": 1684441500,
    "open": 176.87,
    "high": 176.87,
    "low": 176.61,
    "close": 176.65,
    "volume": 50095.0
  },
  {
    "Unnamed: 0.1": 918,
    "Unnamed: 0": 1110,
    "time": 1684441800,
    "open": 176.69,
    "high": 176.69,
    "low": 176.45,
    "close": 176.5,
    "volume": 50192.0
  },
  {
    "Unnamed: 0.1": 919,
    "Unnamed: 0": 1111,
    "time": 1684442100,
    "open": 176.5,
    "high": 176.65,
    "low": 176.45,
    "close": 176.62,
    "volume": 42049.0
  },
  {
    "Unnamed: 0.1": 920,
    "Unnamed: 0": 1112,
    "time": 1684442400,
    "open": 176.64,
    "high": 176.67,
    "low": 176.53,
    "close": 176.6,
    "volume": 16328.0
  },
  {
    "Unnamed: 0.1": 921,
    "Unnamed: 0": 1113,
    "time": 1684442700,
    "open": 176.6,
    "high": 176.67,
    "low": 176.54,
    "close": 176.55,
    "volume": 14464.0
  },
  {
    "Unnamed: 0.1": 922,
    "Unnamed: 0": 1114,
    "time": 1684443000,
    "open": 176.55,
    "high": 176.6,
    "low": 176.54,
    "close": 176.54,
    "volume": 8837.0
  },
  {
    "Unnamed: 0.1": 923,
    "Unnamed: 0": 1115,
    "time": 1684443300,
    "open": 176.58,
    "high": 176.65,
    "low": 176.54,
    "close": 176.6,
    "volume": 14585.0
  },
  {
    "Unnamed: 0.1": 924,
    "Unnamed: 0": 1116,
    "time": 1684443600,
    "open": 176.66,
    "high": 176.75,
    "low": 176.64,
    "close": 176.7,
    "volume": 11833.0
  },
  {
    "Unnamed: 0.1": 925,
    "Unnamed: 0": 1117,
    "time": 1684443900,
    "open": 176.73,
    "high": 176.75,
    "low": 176.61,
    "close": 176.69,
    "volume": 10116.0
  },
  {
    "Unnamed: 0.1": 926,
    "Unnamed: 0": 1118,
    "time": 1684444200,
    "open": 176.69,
    "high": 176.77,
    "low": 176.65,
    "close": 176.75,
    "volume": 9430.0
  },
  {
    "Unnamed: 0.1": 927,
    "Unnamed: 0": 1119,
    "time": 1684444500,
    "open": 176.69,
    "high": 176.71,
    "low": 176.66,
    "close": 176.68,
    "volume": 7830.0
  },
  {
    "Unnamed: 0.1": 928,
    "Unnamed: 0": 1120,
    "time": 1684444800,
    "open": 176.7,
    "high": 176.75,
    "low": 176.66,
    "close": 176.72,
    "volume": 6784.0
  },
  {
    "Unnamed: 0.1": 929,
    "Unnamed: 0": 1121,
    "time": 1684445100,
    "open": 176.67,
    "high": 176.72,
    "low": 176.63,
    "close": 176.69,
    "volume": 14323.0
  },
  {
    "Unnamed: 0.1": 930,
    "Unnamed: 0": 1122,
    "time": 1684445400,
    "open": 176.69,
    "high": 176.7,
    "low": 176.62,
    "close": 176.69,
    "volume": 3191.0
  },
  {
    "Unnamed: 0.1": 931,
    "Unnamed: 0": 1123,
    "time": 1684445700,
    "open": 176.67,
    "high": 176.7,
    "low": 176.62,
    "close": 176.7,
    "volume": 4584.0
  },
  {
    "Unnamed: 0.1": 932,
    "Unnamed: 0": 1124,
    "time": 1684446000,
    "open": 176.68,
    "high": 176.7,
    "low": 176.63,
    "close": 176.64,
    "volume": 4697.0
  },
  {
    "Unnamed: 0.1": 933,
    "Unnamed: 0": 1125,
    "time": 1684446300,
    "open": 176.69,
    "high": 176.69,
    "low": 176.63,
    "close": 176.67,
    "volume": 3150.0
  },
  {
    "Unnamed: 0.1": 934,
    "Unnamed: 0": 1126,
    "time": 1684446600,
    "open": 176.65,
    "high": 176.67,
    "low": 176.63,
    "close": 176.63,
    "volume": 3525.0
  },
  {
    "Unnamed: 0.1": 935,
    "Unnamed: 0": 1127,
    "time": 1684446900,
    "open": 176.63,
    "high": 176.66,
    "low": 176.58,
    "close": 176.6,
    "volume": 11845.0
  },
  {
    "Unnamed: 0.1": 936,
    "Unnamed: 0": 1128,
    "time": 1684447200,
    "open": 176.59,
    "high": 176.62,
    "low": 176.52,
    "close": 176.53,
    "volume": 14318.0
  },
  {
    "Unnamed: 0.1": 937,
    "Unnamed: 0": 1129,
    "time": 1684447500,
    "open": 176.55,
    "high": 177.11,
    "low": 176.55,
    "close": 176.95,
    "volume": 42681.0
  },
  {
    "Unnamed: 0.1": 938,
    "Unnamed: 0": 1130,
    "time": 1684447800,
    "open": 176.95,
    "high": 177.27,
    "low": 176.95,
    "close": 177.27,
    "volume": 58244.0
  },
  {
    "Unnamed: 0.1": 939,
    "Unnamed: 0": 1131,
    "time": 1684448100,
    "open": 177.28,
    "high": 177.28,
    "low": 177.11,
    "close": 177.21,
    "volume": 18530.0
  },
  {
    "Unnamed: 0.1": 940,
    "Unnamed: 0": 1132,
    "time": 1684448400,
    "open": 177.2,
    "high": 177.42,
    "low": 177.19,
    "close": 177.35,
    "volume": 24668.0
  },
  {
    "Unnamed: 0.1": 941,
    "Unnamed: 0": 1133,
    "time": 1684448700,
    "open": 177.4,
    "high": 177.76,
    "low": 177.4,
    "close": 177.6,
    "volume": 56402.0
  },
  {
    "Unnamed: 0.1": 942,
    "Unnamed: 0": 1134,
    "time": 1684449000,
    "open": 177.6,
    "high": 177.99,
    "low": 177.6,
    "close": 177.99,
    "volume": 78543.0
  },
  {
    "Unnamed: 0.1": 943,
    "Unnamed: 0": 1135,
    "time": 1684449300,
    "open": 177.99,
    "high": 178.4,
    "low": 177.94,
    "close": 178.26,
    "volume": 148364.0
  },
  {
    "Unnamed: 0.1": 944,
    "Unnamed: 0": 1136,
    "time": 1684449600,
    "open": 178.27,
    "high": 178.75,
    "low": 178.23,
    "close": 178.59,
    "volume": 101439.0
  },
  {
    "Unnamed: 0.1": 945,
    "Unnamed: 0": 1137,
    "time": 1684449900,
    "open": 178.55,
    "high": 178.71,
    "low": 178.5,
    "close": 178.67,
    "volume": 57940.0
  },
  {
    "Unnamed: 0.1": 946,
    "Unnamed: 0": 1138,
    "time": 1684450200,
    "open": 178.67,
    "high": 178.93,
    "low": 178.6,
    "close": 178.93,
    "volume": 64742.0
  },
  {
    "Unnamed: 0.1": 947,
    "Unnamed: 0": 1139,
    "time": 1684450500,
    "open": 178.94,
    "high": 179.0,
    "low": 178.75,
    "close": 178.75,
    "volume": 81875.0
  },
  {
    "Unnamed: 0.1": 948,
    "Unnamed: 0": 1140,
    "time": 1684450800,
    "open": 178.75,
    "high": 178.89,
    "low": 178.75,
    "close": 178.8,
    "volume": 32986.0
  },
  {
    "Unnamed: 0.1": 949,
    "Unnamed: 0": 1141,
    "time": 1684451100,
    "open": 178.8,
    "high": 178.98,
    "low": 178.8,
    "close": 178.96,
    "volume": 63185.0
  },
  {
    "Unnamed: 0.1": 950,
    "Unnamed: 0": 1142,
    "time": 1684451400,
    "open": 178.96,
    "high": 178.99,
    "low": 178.85,
    "close": 178.85,
    "volume": 35447.0
  },
  {
    "Unnamed: 0.1": 951,
    "Unnamed: 0": 1143,
    "time": 1684451700,
    "open": 178.85,
    "high": 178.89,
    "low": 178.8,
    "close": 178.82,
    "volume": 24043.0
  },
  {
    "Unnamed: 0.1": 952,
    "Unnamed: 0": 1144,
    "time": 1684452000,
    "open": 178.84,
    "high": 178.89,
    "low": 178.8,
    "close": 178.84,
    "volume": 21787.0
  },
  {
    "Unnamed: 0.1": 953,
    "Unnamed: 0": 1145,
    "time": 1684452300,
    "open": 178.81,
    "high": 178.84,
    "low": 178.79,
    "close": 178.8,
    "volume": 20530.0
  },
  {
    "Unnamed: 0.1": 954,
    "Unnamed: 0": 1146,
    "time": 1684452600,
    "open": 178.8,
    "high": 178.81,
    "low": 178.45,
    "close": 178.5,
    "volume": 47352.0
  },
  {
    "Unnamed: 0.1": 955,
    "Unnamed: 0": 1147,
    "time": 1684452900,
    "open": 178.45,
    "high": 178.59,
    "low": 178.1,
    "close": 178.59,
    "volume": 38766.0
  },
  {
    "Unnamed: 0.1": 956,
    "Unnamed: 0": 1148,
    "time": 1684453200,
    "open": 178.58,
    "high": 178.66,
    "low": 178.35,
    "close": 178.35,
    "volume": 20774.0
  },
  {
    "Unnamed: 0.1": 957,
    "Unnamed: 0": 1149,
    "time": 1684453500,
    "open": 178.35,
    "high": 178.56,
    "low": 178.3,
    "close": 178.46,
    "volume": 29319.0
  },
  {
    "Unnamed: 0.1": 958,
    "Unnamed: 0": 1150,
    "time": 1684453800,
    "open": 178.5,
    "high": 178.53,
    "low": 178.43,
    "close": 178.46,
    "volume": 11812.0
  },
  {
    "Unnamed: 0.1": 959,
    "Unnamed: 0": 1151,
    "time": 1684454100,
    "open": 178.45,
    "high": 178.55,
    "low": 178.3,
    "close": 178.35,
    "volume": 67622.0
  },
  {
    "Unnamed: 0.1": 960,
    "Unnamed: 0": 1344,
    "time": 1684483200,
    "open": 178.21,
    "high": 178.21,
    "low": 177.75,
    "close": 177.97,
    "volume": 8238.0
  },
  {
    "Unnamed: 0.1": 961,
    "Unnamed: 0": 1345,
    "time": 1684483500,
    "open": 177.96,
    "high": 178.01,
    "low": 177.77,
    "close": 177.8,
    "volume": 4563.0
  },
  {
    "Unnamed: 0.1": 962,
    "Unnamed: 0": 1346,
    "time": 1684483800,
    "open": 177.87,
    "high": 178.0,
    "low": 177.83,
    "close": 177.99,
    "volume": 5424.0
  },
  {
    "Unnamed: 0.1": 963,
    "Unnamed: 0": 1347,
    "time": 1684484100,
    "open": 177.93,
    "high": 177.97,
    "low": 177.88,
    "close": 177.89,
    "volume": 1981.0
  },
  {
    "Unnamed: 0.1": 964,
    "Unnamed: 0": 1348,
    "time": 1684484400,
    "open": 177.89,
    "high": 177.94,
    "low": 177.88,
    "close": 177.91,
    "volume": 2927.0
  },
  {
    "Unnamed: 0.1": 965,
    "Unnamed: 0": 1349,
    "time": 1684484700,
    "open": 177.91,
    "high": 178.13,
    "low": 177.91,
    "close": 178.1,
    "volume": 7264.0
  },
  {
    "Unnamed: 0.1": 966,
    "Unnamed: 0": 1350,
    "time": 1684485000,
    "open": 178.18,
    "high": 178.35,
    "low": 178.17,
    "close": 178.19,
    "volume": 2689.0
  },
  {
    "Unnamed: 0.1": 967,
    "Unnamed: 0": 1351,
    "time": 1684485300,
    "open": 178.25,
    "high": 178.3,
    "low": 178.24,
    "close": 178.26,
    "volume": 2312.0
  },
  {
    "Unnamed: 0.1": 968,
    "Unnamed: 0": 1352,
    "time": 1684485600,
    "open": 178.15,
    "high": 178.29,
    "low": 178.12,
    "close": 178.12,
    "volume": 3008.0
  },
  {
    "Unnamed: 0.1": 969,
    "Unnamed: 0": 1353,
    "time": 1684485900,
    "open": 178.13,
    "high": 178.3,
    "low": 178.13,
    "close": 178.21,
    "volume": 2034.0
  },
  {
    "Unnamed: 0.1": 970,
    "Unnamed: 0": 1354,
    "time": 1684486200,
    "open": 178.21,
    "high": 178.35,
    "low": 178.2,
    "close": 178.35,
    "volume": 1289.0
  },
  {
    "Unnamed: 0.1": 971,
    "Unnamed: 0": 1355,
    "time": 1684486500,
    "open": 178.35,
    "high": 178.5,
    "low": 178.33,
    "close": 178.4,
    "volume": 2796.0
  },
  {
    "Unnamed: 0.1": 972,
    "Unnamed: 0": 1356,
    "time": 1684486800,
    "open": 178.43,
    "high": 178.47,
    "low": 178.4,
    "close": 178.44,
    "volume": 839.0
  },
  {
    "Unnamed: 0.1": 973,
    "Unnamed: 0": 1357,
    "time": 1684487100,
    "open": 178.4,
    "high": 178.4,
    "low": 178.32,
    "close": 178.32,
    "volume": 991.0
  },
  {
    "Unnamed: 0.1": 974,
    "Unnamed: 0": 1358,
    "time": 1684487400,
    "open": 178.26,
    "high": 178.3,
    "low": 178.25,
    "close": 178.3,
    "volume": 1049.0
  },
  {
    "Unnamed: 0.1": 975,
    "Unnamed: 0": 1359,
    "time": 1684487700,
    "open": 178.3,
    "high": 178.3,
    "low": 178.29,
    "close": 178.29,
    "volume": 238.0
  },
  {
    "Unnamed: 0.1": 976,
    "Unnamed: 0": 1360,
    "time": 1684488000,
    "open": 178.27,
    "high": 178.27,
    "low": 177.9,
    "close": 178.02,
    "volume": 8022.0
  },
  {
    "Unnamed: 0.1": 977,
    "Unnamed: 0": 1361,
    "time": 1684488300,
    "open": 178.0,
    "high": 178.22,
    "low": 178.0,
    "close": 178.22,
    "volume": 1055.0
  },
  {
    "Unnamed: 0.1": 978,
    "Unnamed: 0": 1362,
    "time": 1684488600,
    "open": 178.18,
    "high": 178.18,
    "low": 178.07,
    "close": 178.07,
    "volume": 798.0
  },
  {
    "Unnamed: 0.1": 979,
    "Unnamed: 0": 1363,
    "time": 1684488900,
    "open": 178.13,
    "high": 178.17,
    "low": 178.11,
    "close": 178.11,
    "volume": 900.0
  },
  {
    "Unnamed: 0.1": 980,
    "Unnamed: 0": 1364,
    "time": 1684489200,
    "open": 178.13,
    "high": 178.14,
    "low": 178.12,
    "close": 178.14,
    "volume": 698.0
  },
  {
    "Unnamed: 0.1": 981,
    "Unnamed: 0": 1365,
    "time": 1684489500,
    "open": 178.16,
    "high": 178.3,
    "low": 178.16,
    "close": 178.2,
    "volume": 1974.0
  },
  {
    "Unnamed: 0.1": 982,
    "Unnamed: 0": 1366,
    "time": 1684489800,
    "open": 178.28,
    "high": 178.31,
    "low": 178.28,
    "close": 178.29,
    "volume": 400.0
  },
  {
    "Unnamed: 0.1": 983,
    "Unnamed: 0": 1367,
    "time": 1684490100,
    "open": 178.32,
    "high": 178.32,
    "low": 178.32,
    "close": 178.32,
    "volume": 100.0
  },
  {
    "Unnamed: 0.1": 984,
    "Unnamed: 0": 1368,
    "time": 1684490400,
    "open": 178.32,
    "high": 178.32,
    "low": 178.24,
    "close": 178.24,
    "volume": 648.0
  },
  {
    "Unnamed: 0.1": 985,
    "Unnamed: 0": 1369,
    "time": 1684490700,
    "open": 178.27,
    "high": 178.3,
    "low": 178.22,
    "close": 178.22,
    "volume": 2054.0
  },
  {
    "Unnamed: 0.1": 986,
    "Unnamed: 0": 1370,
    "time": 1684491000,
    "open": 178.23,
    "high": 178.26,
    "low": 178.23,
    "close": 178.26,
    "volume": 212.0
  },
  {
    "Unnamed: 0.1": 987,
    "Unnamed: 0": 1371,
    "time": 1684491300,
    "open": 178.2,
    "high": 178.2,
    "low": 177.9,
    "close": 177.93,
    "volume": 7212.0
  },
  {
    "Unnamed: 0.1": 988,
    "Unnamed: 0": 1372,
    "time": 1684491600,
    "open": 177.93,
    "high": 178.06,
    "low": 177.93,
    "close": 178.06,
    "volume": 1727.0
  },
  {
    "Unnamed: 0.1": 989,
    "Unnamed: 0": 1373,
    "time": 1684491900,
    "open": 178.02,
    "high": 178.22,
    "low": 178.02,
    "close": 178.04,
    "volume": 1219.0
  },
  {
    "Unnamed: 0.1": 990,
    "Unnamed: 0": 1374,
    "time": 1684492200,
    "open": 178.14,
    "high": 178.14,
    "low": 177.84,
    "close": 177.84,
    "volume": 3080.0
  },
  {
    "Unnamed: 0.1": 991,
    "Unnamed: 0": 1375,
    "time": 1684492500,
    "open": 177.83,
    "high": 177.94,
    "low": 177.81,
    "close": 177.88,
    "volume": 2987.0
  },
  {
    "Unnamed: 0.1": 992,
    "Unnamed: 0": 1376,
    "time": 1684492800,
    "open": 177.94,
    "high": 177.94,
    "low": 177.64,
    "close": 177.64,
    "volume": 6241.0
  },
  {
    "Unnamed: 0.1": 993,
    "Unnamed: 0": 1377,
    "time": 1684493100,
    "open": 177.63,
    "high": 177.63,
    "low": 177.11,
    "close": 177.49,
    "volume": 8171.0
  },
  {
    "Unnamed: 0.1": 994,
    "Unnamed: 0": 1378,
    "time": 1684493400,
    "open": 177.26,
    "high": 177.37,
    "low": 177.18,
    "close": 177.18,
    "volume": 3498.0
  },
  {
    "Unnamed: 0.1": 995,
    "Unnamed: 0": 1379,
    "time": 1684493700,
    "open": 177.11,
    "high": 177.3,
    "low": 177.06,
    "close": 177.25,
    "volume": 13841.0
  },
  {
    "Unnamed: 0.1": 996,
    "Unnamed: 0": 1380,
    "time": 1684494000,
    "open": 177.3,
    "high": 177.8,
    "low": 177.2,
    "close": 177.51,
    "volume": 45000.0
  },
  {
    "Unnamed: 0.1": 997,
    "Unnamed: 0": 1381,
    "time": 1684494300,
    "open": 177.56,
    "high": 177.6,
    "low": 177.4,
    "close": 177.55,
    "volume": 14973.0
  },
  {
    "Unnamed: 0.1": 998,
    "Unnamed: 0": 1382,
    "time": 1684494600,
    "open": 177.58,
    "high": 177.7,
    "low": 177.55,
    "close": 177.68,
    "volume": 14507.0
  },
  {
    "Unnamed: 0.1": 999,
    "Unnamed: 0": 1383,
    "time": 1684494900,
    "open": 177.67,
    "high": 177.82,
    "low": 177.59,
    "close": 177.76,
    "volume": 12653.0
  },
  {
    "Unnamed: 0.1": 1000,
    "Unnamed: 0": 1384,
    "time": 1684495200,
    "open": 177.78,
    "high": 177.78,
    "low": 177.68,
    "close": 177.76,
    "volume": 14985.0
  },
  {
    "Unnamed: 0.1": 1001,
    "Unnamed: 0": 1385,
    "time": 1684495500,
    "open": 177.77,
    "high": 177.78,
    "low": 177.64,
    "close": 177.67,
    "volume": 13948.0
  },
  {
    "Unnamed: 0.1": 1002,
    "Unnamed: 0": 1386,
    "time": 1684495800,
    "open": 177.7,
    "high": 177.7,
    "low": 177.56,
    "close": 177.56,
    "volume": 14885.0
  },
  {
    "Unnamed: 0.1": 1003,
    "Unnamed: 0": 1387,
    "time": 1684496100,
    "open": 177.52,
    "high": 177.55,
    "low": 177.35,
    "close": 177.5,
    "volume": 10830.0
  },
  {
    "Unnamed: 0.1": 1004,
    "Unnamed: 0": 1388,
    "time": 1684496400,
    "open": 177.5,
    "high": 177.55,
    "low": 177.25,
    "close": 177.3,
    "volume": 12375.0
  },
  {
    "Unnamed: 0.1": 1005,
    "Unnamed: 0": 1389,
    "time": 1684496700,
    "open": 177.27,
    "high": 177.27,
    "low": 176.9,
    "close": 177.0,
    "volume": 35635.0
  },
  {
    "Unnamed: 0.1": 1006,
    "Unnamed: 0": 1390,
    "time": 1684497000,
    "open": 177.0,
    "high": 177.38,
    "low": 177.0,
    "close": 177.33,
    "volume": 11596.0
  },
  {
    "Unnamed: 0.1": 1007,
    "Unnamed: 0": 1391,
    "time": 1684497300,
    "open": 177.35,
    "high": 177.55,
    "low": 177.31,
    "close": 177.37,
    "volume": 5392.0
  },
  {
    "Unnamed: 0.1": 1008,
    "Unnamed: 0": 1392,
    "time": 1684497600,
    "open": 177.28,
    "high": 178.6,
    "low": 176.91,
    "close": 177.72,
    "volume": 202208.0
  },
  {
    "Unnamed: 0.1": 1009,
    "Unnamed: 0": 1393,
    "time": 1684497900,
    "open": 177.7,
    "high": 177.78,
    "low": 177.57,
    "close": 177.61,
    "volume": 38900.0
  },
  {
    "Unnamed: 0.1": 1010,
    "Unnamed: 0": 1394,
    "time": 1684498200,
    "open": 177.52,
    "high": 177.59,
    "low": 177.4,
    "close": 177.44,
    "volume": 21844.0
  },
  {
    "Unnamed: 0.1": 1011,
    "Unnamed: 0": 1395,
    "time": 1684498500,
    "open": 177.51,
    "high": 177.69,
    "low": 177.3,
    "close": 177.57,
    "volume": 31949.0
  },
  {
    "Unnamed: 0.1": 1012,
    "Unnamed: 0": 1396,
    "time": 1684498800,
    "open": 177.6,
    "high": 177.83,
    "low": 177.57,
    "close": 177.72,
    "volume": 41630.0
  },
  {
    "Unnamed: 0.1": 1013,
    "Unnamed: 0": 1397,
    "time": 1684499100,
    "open": 177.74,
    "high": 177.8,
    "low": 177.65,
    "close": 177.72,
    "volume": 23618.0
  },
  {
    "Unnamed: 0.1": 1014,
    "Unnamed: 0": 1398,
    "time": 1684499400,
    "open": 177.7,
    "high": 177.8,
    "low": 177.66,
    "close": 177.75,
    "volume": 25369.0
  },
  {
    "Unnamed: 0.1": 1015,
    "Unnamed: 0": 1399,
    "time": 1684499700,
    "open": 177.73,
    "high": 177.79,
    "low": 177.42,
    "close": 177.5,
    "volume": 27068.0
  },
  {
    "Unnamed: 0.1": 1016,
    "Unnamed: 0": 1400,
    "time": 1684500000,
    "open": 177.48,
    "high": 177.84,
    "low": 177.48,
    "close": 177.84,
    "volume": 31161.0
  },
  {
    "Unnamed: 0.1": 1017,
    "Unnamed: 0": 1401,
    "time": 1684500300,
    "open": 177.84,
    "high": 177.89,
    "low": 177.51,
    "close": 177.7,
    "volume": 41654.0
  },
  {
    "Unnamed: 0.1": 1018,
    "Unnamed: 0": 1402,
    "time": 1684500600,
    "open": 177.65,
    "high": 177.7,
    "low": 177.42,
    "close": 177.63,
    "volume": 19817.0
  },
  {
    "Unnamed: 0.1": 1019,
    "Unnamed: 0": 1403,
    "time": 1684500900,
    "open": 177.55,
    "high": 178.1,
    "low": 177.55,
    "close": 177.91,
    "volume": 72778.0
  },
  {
    "Unnamed: 0.1": 1020,
    "Unnamed: 0": 1404,
    "time": 1684501200,
    "open": 177.9,
    "high": 178.1,
    "low": 177.84,
    "close": 178.04,
    "volume": 34061.0
  },
  {
    "Unnamed: 0.1": 1021,
    "Unnamed: 0": 1405,
    "time": 1684501500,
    "open": 178.1,
    "high": 178.1,
    "low": 177.84,
    "close": 178.01,
    "volume": 39269.0
  },
  {
    "Unnamed: 0.1": 1022,
    "Unnamed: 0": 1406,
    "time": 1684501800,
    "open": 178.0,
    "high": 178.1,
    "low": 177.81,
    "close": 177.86,
    "volume": 50043.0
  },
  {
    "Unnamed: 0.1": 1023,
    "Unnamed: 0": 1407,
    "time": 1684502100,
    "open": 177.86,
    "high": 178.05,
    "low": 177.85,
    "close": 177.98,
    "volume": 33524.0
  },
  {
    "Unnamed: 0.1": 1024,
    "Unnamed: 0": 1408,
    "time": 1684502400,
    "open": 178.0,
    "high": 178.05,
    "low": 177.62,
    "close": 177.79,
    "volume": 34688.0
  },
  {
    "Unnamed: 0.1": 1025,
    "Unnamed: 0": 1409,
    "time": 1684502700,
    "open": 177.84,
    "high": 177.85,
    "low": 177.0,
    "close": 177.4,
    "volume": 100788.0
  },
  {
    "Unnamed: 0.1": 1026,
    "Unnamed: 0": 1410,
    "time": 1684503000,
    "open": 177.17,
    "high": 178.43,
    "low": 176.31,
    "close": 178.32,
    "volume": 3748609.0
  },
  {
    "Unnamed: 0.1": 1027,
    "Unnamed: 0": 1411,
    "time": 1684503300,
    "open": 178.31,
    "high": 179.85,
    "low": 178.11,
    "close": 179.41,
    "volume": 3402814.0
  },
  {
    "Unnamed: 0.1": 1028,
    "Unnamed: 0": 1412,
    "time": 1684503600,
    "open": 179.4,
    "high": 179.76,
    "low": 178.77,
    "close": 179.4,
    "volume": 2569120.0
  },
  {
    "Unnamed: 0.1": 1029,
    "Unnamed: 0": 1413,
    "time": 1684503900,
    "open": 179.4,
    "high": 179.66,
    "low": 178.01,
    "close": 178.17,
    "volume": 2540526.0
  },
  {
    "Unnamed: 0.1": 1030,
    "Unnamed: 0": 1414,
    "time": 1684504200,
    "open": 178.18,
    "high": 178.99,
    "low": 178.02,
    "close": 178.47,
    "volume": 1804875.0
  },
  {
    "Unnamed: 0.1": 1031,
    "Unnamed: 0": 1415,
    "time": 1684504500,
    "open": 178.47,
    "high": 179.4,
    "low": 178.45,
    "close": 179.16,
    "volume": 2080936.0
  },
  {
    "Unnamed: 0.1": 1032,
    "Unnamed: 0": 1416,
    "time": 1684504800,
    "open": 179.16,
    "high": 179.38,
    "low": 178.51,
    "close": 178.9,
    "volume": 2109541.0
  },
  {
    "Unnamed: 0.1": 1033,
    "Unnamed: 0": 1417,
    "time": 1684505100,
    "open": 178.9,
    "high": 180.25,
    "low": 178.54,
    "close": 179.94,
    "volume": 2837666.0
  },
  {
    "Unnamed: 0.1": 1034,
    "Unnamed: 0": 1418,
    "time": 1684505400,
    "open": 179.94,
    "high": 180.16,
    "low": 179.39,
    "close": 179.66,
    "volume": 2218580.0
  },
  {
    "Unnamed: 0.1": 1035,
    "Unnamed: 0": 1419,
    "time": 1684505700,
    "open": 179.7,
    "high": 180.25,
    "low": 179.57,
    "close": 180.04,
    "volume": 2138167.0
  },
  {
    "Unnamed: 0.1": 1036,
    "Unnamed: 0": 1420,
    "time": 1684506000,
    "open": 180.05,
    "high": 180.84,
    "low": 179.91,
    "close": 180.78,
    "volume": 2616579.0
  },
  {
    "Unnamed: 0.1": 1037,
    "Unnamed: 0": 1421,
    "time": 1684506300,
    "open": 180.77,
    "high": 181.28,
    "low": 180.3,
    "close": 181.27,
    "volume": 2519265.0
  },
  {
    "Unnamed: 0.1": 1038,
    "Unnamed: 0": 1422,
    "time": 1684506600,
    "open": 181.28,
    "high": 181.95,
    "low": 180.96,
    "close": 181.18,
    "volume": 3069846.0
  },
  {
    "Unnamed: 0.1": 1039,
    "Unnamed: 0": 1423,
    "time": 1684506900,
    "open": 181.16,
    "high": 181.42,
    "low": 180.32,
    "close": 180.84,
    "volume": 2072413.0
  },
  {
    "Unnamed: 0.1": 1040,
    "Unnamed: 0": 1424,
    "time": 1684507200,
    "open": 180.83,
    "high": 181.19,
    "low": 180.5,
    "close": 180.76,
    "volume": 1841608.0
  },
  {
    "Unnamed: 0.1": 1041,
    "Unnamed: 0": 1425,
    "time": 1684507500,
    "open": 180.74,
    "high": 181.04,
    "low": 180.43,
    "close": 180.66,
    "volume": 1587646.0
  },
  {
    "Unnamed: 0.1": 1042,
    "Unnamed: 0": 1426,
    "time": 1684507800,
    "open": 180.65,
    "high": 180.75,
    "low": 179.51,
    "close": 180.04,
    "volume": 2718764.0
  },
  {
    "Unnamed: 0.1": 1043,
    "Unnamed: 0": 1427,
    "time": 1684508100,
    "open": 180.04,
    "high": 180.6,
    "low": 179.73,
    "close": 180.48,
    "volume": 1737524.0
  },
  {
    "Unnamed: 0.1": 1044,
    "Unnamed: 0": 1428,
    "time": 1684508400,
    "open": 180.48,
    "high": 181.09,
    "low": 180.29,
    "close": 181.05,
    "volume": 1523983.0
  },
  {
    "Unnamed: 0.1": 1045,
    "Unnamed: 0": 1429,
    "time": 1684508700,
    "open": 181.08,
    "high": 181.23,
    "low": 180.48,
    "close": 180.64,
    "volume": 1718579.0
  },
  {
    "Unnamed: 0.1": 1046,
    "Unnamed: 0": 1430,
    "time": 1684509000,
    "open": 180.62,
    "high": 181.0,
    "low": 180.16,
    "close": 180.53,
    "volume": 1395093.0
  },
  {
    "Unnamed: 0.1": 1047,
    "Unnamed: 0": 1431,
    "time": 1684509300,
    "open": 180.52,
    "high": 180.78,
    "low": 179.72,
    "close": 179.94,
    "volume": 1771091.0
  },
  {
    "Unnamed: 0.1": 1048,
    "Unnamed: 0": 1432,
    "time": 1684509600,
    "open": 179.94,
    "high": 180.3,
    "low": 179.61,
    "close": 179.9,
    "volume": 1564628.0
  },
  {
    "Unnamed: 0.1": 1049,
    "Unnamed: 0": 1433,
    "time": 1684509900,
    "open": 179.91,
    "high": 180.19,
    "low": 178.82,
    "close": 178.82,
    "volume": 1976706.0
  },
  {
    "Unnamed: 0.1": 1050,
    "Unnamed: 0": 1434,
    "time": 1684510200,
    "open": 178.82,
    "high": 179.08,
    "low": 177.83,
    "close": 178.05,
    "volume": 2399758.0
  },
  {
    "Unnamed: 0.1": 1051,
    "Unnamed: 0": 1435,
    "time": 1684510500,
    "open": 178.07,
    "high": 178.12,
    "low": 177.22,
    "close": 177.64,
    "volume": 2291510.0
  },
  {
    "Unnamed: 0.1": 1052,
    "Unnamed: 0": 1436,
    "time": 1684510800,
    "open": 177.63,
    "high": 178.44,
    "low": 177.22,
    "close": 178.34,
    "volume": 1927171.0
  },
  {
    "Unnamed: 0.1": 1053,
    "Unnamed: 0": 1437,
    "time": 1684511100,
    "open": 178.36,
    "high": 179.2,
    "low": 178.31,
    "close": 179.08,
    "volume": 1970492.0
  },
  {
    "Unnamed: 0.1": 1054,
    "Unnamed: 0": 1438,
    "time": 1684511400,
    "open": 179.08,
    "high": 179.22,
    "low": 178.72,
    "close": 179.03,
    "volume": 1480439.0
  },
  {
    "Unnamed: 0.1": 1055,
    "Unnamed: 0": 1439,
    "time": 1684511700,
    "open": 179.05,
    "high": 179.68,
    "low": 178.96,
    "close": 179.37,
    "volume": 1544378.0
  },
  {
    "Unnamed: 0.1": 1056,
    "Unnamed: 0": 1440,
    "time": 1684512000,
    "open": 179.37,
    "high": 179.65,
    "low": 178.8,
    "close": 179.18,
    "volume": 1444836.0
  },
  {
    "Unnamed: 0.1": 1057,
    "Unnamed: 0": 1441,
    "time": 1684512300,
    "open": 179.16,
    "high": 179.25,
    "low": 178.75,
    "close": 179.08,
    "volume": 1120301.0
  },
  {
    "Unnamed: 0.1": 1058,
    "Unnamed: 0": 1442,
    "time": 1684512600,
    "open": 179.07,
    "high": 179.52,
    "low": 178.97,
    "close": 179.01,
    "volume": 1219155.0
  },
  {
    "Unnamed: 0.1": 1059,
    "Unnamed: 0": 1443,
    "time": 1684512900,
    "open": 179.0,
    "high": 179.6,
    "low": 178.73,
    "close": 179.4,
    "volume": 1373080.0
  },
  {
    "Unnamed: 0.1": 1060,
    "Unnamed: 0": 1444,
    "time": 1684513200,
    "open": 179.38,
    "high": 179.75,
    "low": 179.37,
    "close": 179.61,
    "volume": 1210275.0
  },
  {
    "Unnamed: 0.1": 1061,
    "Unnamed: 0": 1445,
    "time": 1684513500,
    "open": 179.59,
    "high": 179.65,
    "low": 179.04,
    "close": 179.04,
    "volume": 1049496.0
  },
  {
    "Unnamed: 0.1": 1062,
    "Unnamed: 0": 1446,
    "time": 1684513800,
    "open": 179.03,
    "high": 179.04,
    "low": 178.36,
    "close": 178.44,
    "volume": 1456609.0
  },
  {
    "Unnamed: 0.1": 1063,
    "Unnamed: 0": 1447,
    "time": 1684514100,
    "open": 178.43,
    "high": 179.33,
    "low": 178.36,
    "close": 179.24,
    "volume": 1333331.0
  },
  {
    "Unnamed: 0.1": 1064,
    "Unnamed: 0": 1448,
    "time": 1684514400,
    "open": 179.25,
    "high": 179.39,
    "low": 178.94,
    "close": 179.25,
    "volume": 864326.0
  },
  {
    "Unnamed: 0.1": 1065,
    "Unnamed: 0": 1449,
    "time": 1684514700,
    "open": 179.24,
    "high": 179.41,
    "low": 178.83,
    "close": 178.99,
    "volume": 920581.0
  },
  {
    "Unnamed: 0.1": 1066,
    "Unnamed: 0": 1450,
    "time": 1684515000,
    "open": 178.99,
    "high": 179.47,
    "low": 178.91,
    "close": 179.43,
    "volume": 941203.0
  },
  {
    "Unnamed: 0.1": 1067,
    "Unnamed: 0": 1451,
    "time": 1684515300,
    "open": 179.42,
    "high": 179.74,
    "low": 179.26,
    "close": 179.44,
    "volume": 1024313.0
  },
  {
    "Unnamed: 0.1": 1068,
    "Unnamed: 0": 1452,
    "time": 1684515600,
    "open": 179.43,
    "high": 179.99,
    "low": 179.41,
    "close": 179.96,
    "volume": 1311406.0
  },
  {
    "Unnamed: 0.1": 1069,
    "Unnamed: 0": 1453,
    "time": 1684515900,
    "open": 179.95,
    "high": 180.17,
    "low": 179.62,
    "close": 179.71,
    "volume": 1329561.0
  },
  {
    "Unnamed: 0.1": 1070,
    "Unnamed: 0": 1454,
    "time": 1684516200,
    "open": 179.7,
    "high": 179.92,
    "low": 179.52,
    "close": 179.87,
    "volume": 888654.0
  },
  {
    "Unnamed: 0.1": 1071,
    "Unnamed: 0": 1455,
    "time": 1684516500,
    "open": 179.87,
    "high": 180.18,
    "low": 179.76,
    "close": 180.01,
    "volume": 922196.0
  },
  {
    "Unnamed: 0.1": 1072,
    "Unnamed: 0": 1456,
    "time": 1684516800,
    "open": 180.01,
    "high": 180.37,
    "low": 179.95,
    "close": 180.31,
    "volume": 1113917.0
  },
  {
    "Unnamed: 0.1": 1073,
    "Unnamed: 0": 1457,
    "time": 1684517100,
    "open": 180.31,
    "high": 180.49,
    "low": 180.04,
    "close": 180.45,
    "volume": 1107579.0
  },
  {
    "Unnamed: 0.1": 1074,
    "Unnamed: 0": 1458,
    "time": 1684517400,
    "open": 180.46,
    "high": 180.49,
    "low": 180.1,
    "close": 180.45,
    "volume": 868574.0
  },
  {
    "Unnamed: 0.1": 1075,
    "Unnamed: 0": 1459,
    "time": 1684517700,
    "open": 180.43,
    "high": 180.57,
    "low": 179.96,
    "close": 180.09,
    "volume": 1039055.0
  },
  {
    "Unnamed: 0.1": 1076,
    "Unnamed: 0": 1460,
    "time": 1684518000,
    "open": 180.07,
    "high": 180.2,
    "low": 179.85,
    "close": 180.1,
    "volume": 868620.0
  },
  {
    "Unnamed: 0.1": 1077,
    "Unnamed: 0": 1461,
    "time": 1684518300,
    "open": 180.12,
    "high": 180.25,
    "low": 179.87,
    "close": 180.02,
    "volume": 766527.0
  },
  {
    "Unnamed: 0.1": 1078,
    "Unnamed: 0": 1462,
    "time": 1684518600,
    "open": 180.01,
    "high": 180.13,
    "low": 179.72,
    "close": 180.0,
    "volume": 780675.0
  },
  {
    "Unnamed: 0.1": 1079,
    "Unnamed: 0": 1463,
    "time": 1684518900,
    "open": 179.99,
    "high": 180.17,
    "low": 179.77,
    "close": 179.82,
    "volume": 681926.0
  },
  {
    "Unnamed: 0.1": 1080,
    "Unnamed: 0": 1464,
    "time": 1684519200,
    "open": 179.81,
    "high": 180.1,
    "low": 179.55,
    "close": 179.93,
    "volume": 944804.0
  },
  {
    "Unnamed: 0.1": 1081,
    "Unnamed: 0": 1465,
    "time": 1684519500,
    "open": 179.94,
    "high": 180.09,
    "low": 179.79,
    "close": 179.84,
    "volume": 641722.0
  },
  {
    "Unnamed: 0.1": 1082,
    "Unnamed: 0": 1466,
    "time": 1684519800,
    "open": 179.82,
    "high": 180.0,
    "low": 179.72,
    "close": 179.94,
    "volume": 602257.0
  },
  {
    "Unnamed: 0.1": 1083,
    "Unnamed: 0": 1467,
    "time": 1684520100,
    "open": 179.95,
    "high": 180.36,
    "low": 179.68,
    "close": 180.33,
    "volume": 1095696.0
  },
  {
    "Unnamed: 0.1": 1084,
    "Unnamed: 0": 1468,
    "time": 1684520400,
    "open": 180.33,
    "high": 180.48,
    "low": 180.07,
    "close": 180.16,
    "volume": 847671.0
  },
  {
    "Unnamed: 0.1": 1085,
    "Unnamed: 0": 1469,
    "time": 1684520700,
    "open": 180.15,
    "high": 180.19,
    "low": 179.52,
    "close": 179.65,
    "volume": 932456.0
  },
  {
    "Unnamed: 0.1": 1086,
    "Unnamed: 0": 1470,
    "time": 1684521000,
    "open": 179.66,
    "high": 179.68,
    "low": 179.1,
    "close": 179.42,
    "volume": 1231696.0
  },
  {
    "Unnamed: 0.1": 1087,
    "Unnamed: 0": 1471,
    "time": 1684521300,
    "open": 179.4,
    "high": 179.54,
    "low": 179.12,
    "close": 179.15,
    "volume": 841476.0
  },
  {
    "Unnamed: 0.1": 1088,
    "Unnamed: 0": 1472,
    "time": 1684521600,
    "open": 179.13,
    "high": 179.43,
    "low": 178.7,
    "close": 179.39,
    "volume": 1319758.0
  },
  {
    "Unnamed: 0.1": 1089,
    "Unnamed: 0": 1473,
    "time": 1684521900,
    "open": 179.38,
    "high": 179.38,
    "low": 178.9,
    "close": 179.04,
    "volume": 788237.0
  },
  {
    "Unnamed: 0.1": 1090,
    "Unnamed: 0": 1474,
    "time": 1684522200,
    "open": 179.03,
    "high": 179.34,
    "low": 178.91,
    "close": 179.24,
    "volume": 784896.0
  },
  {
    "Unnamed: 0.1": 1091,
    "Unnamed: 0": 1475,
    "time": 1684522500,
    "open": 179.24,
    "high": 179.42,
    "low": 179.22,
    "close": 179.39,
    "volume": 648186.0
  },
  {
    "Unnamed: 0.1": 1092,
    "Unnamed: 0": 1476,
    "time": 1684522800,
    "open": 179.38,
    "high": 179.5,
    "low": 179.2,
    "close": 179.38,
    "volume": 666866.0
  },
  {
    "Unnamed: 0.1": 1093,
    "Unnamed: 0": 1477,
    "time": 1684523100,
    "open": 179.38,
    "high": 179.49,
    "low": 179.16,
    "close": 179.32,
    "volume": 688147.0
  },
  {
    "Unnamed: 0.1": 1094,
    "Unnamed: 0": 1478,
    "time": 1684523400,
    "open": 179.33,
    "high": 179.51,
    "low": 179.29,
    "close": 179.47,
    "volume": 723754.0
  },
  {
    "Unnamed: 0.1": 1095,
    "Unnamed: 0": 1479,
    "time": 1684523700,
    "open": 179.46,
    "high": 179.86,
    "low": 179.44,
    "close": 179.83,
    "volume": 1023234.0
  },
  {
    "Unnamed: 0.1": 1096,
    "Unnamed: 0": 1480,
    "time": 1684524000,
    "open": 179.83,
    "high": 179.9,
    "low": 179.62,
    "close": 179.78,
    "volume": 671651.0
  },
  {
    "Unnamed: 0.1": 1097,
    "Unnamed: 0": 1481,
    "time": 1684524300,
    "open": 179.79,
    "high": 179.87,
    "low": 179.42,
    "close": 179.46,
    "volume": 731655.0
  },
  {
    "Unnamed: 0.1": 1098,
    "Unnamed: 0": 1482,
    "time": 1684524600,
    "open": 179.47,
    "high": 179.65,
    "low": 179.41,
    "close": 179.53,
    "volume": 619922.0
  },
  {
    "Unnamed: 0.1": 1099,
    "Unnamed: 0": 1483,
    "time": 1684524900,
    "open": 179.53,
    "high": 179.9,
    "low": 179.48,
    "close": 179.78,
    "volume": 746590.0
  },
  {
    "Unnamed: 0.1": 1100,
    "Unnamed: 0": 1484,
    "time": 1684525200,
    "open": 179.77,
    "high": 180.0,
    "low": 179.75,
    "close": 179.96,
    "volume": 774208.0
  },
  {
    "Unnamed: 0.1": 1101,
    "Unnamed: 0": 1485,
    "time": 1684525500,
    "open": 179.97,
    "high": 180.11,
    "low": 179.78,
    "close": 179.96,
    "volume": 1103745.0
  },
  {
    "Unnamed: 0.1": 1102,
    "Unnamed: 0": 1486,
    "time": 1684525800,
    "open": 179.95,
    "high": 180.27,
    "low": 179.9,
    "close": 180.17,
    "volume": 1101989.0
  },
  {
    "Unnamed: 0.1": 1103,
    "Unnamed: 0": 1487,
    "time": 1684526100,
    "open": 180.18,
    "high": 180.28,
    "low": 179.93,
    "close": 180.13,
    "volume": 2481817.0
  },
  {
    "Unnamed: 0.1": 1104,
    "Unnamed: 0": 1488,
    "time": 1684526400,
    "open": 180.13,
    "high": 180.14,
    "low": 179.96,
    "close": 180.09,
    "volume": 1828754.0
  },
  {
    "Unnamed: 0.1": 1105,
    "Unnamed: 0": 1489,
    "time": 1684526700,
    "open": 180.1,
    "high": 180.14,
    "low": 179.94,
    "close": 180.14,
    "volume": 122120.0
  },
  {
    "Unnamed: 0.1": 1106,
    "Unnamed: 0": 1490,
    "time": 1684527000,
    "open": 179.96,
    "high": 180.14,
    "low": 179.95,
    "close": 179.99,
    "volume": 40399.0
  },
  {
    "Unnamed: 0.1": 1107,
    "Unnamed: 0": 1491,
    "time": 1684527300,
    "open": 179.99,
    "high": 180.02,
    "low": 179.96,
    "close": 180.0,
    "volume": 47062.0
  },
  {
    "Unnamed: 0.1": 1108,
    "Unnamed: 0": 1492,
    "time": 1684527600,
    "open": 180.0,
    "high": 180.0,
    "low": 179.96,
    "close": 179.99,
    "volume": 15238.0
  },
  {
    "Unnamed: 0.1": 1109,
    "Unnamed: 0": 1493,
    "time": 1684527900,
    "open": 179.99,
    "high": 180.0,
    "low": 179.94,
    "close": 179.96,
    "volume": 36255.0
  },
  {
    "Unnamed: 0.1": 1110,
    "Unnamed: 0": 1494,
    "time": 1684528200,
    "open": 179.93,
    "high": 180.02,
    "low": 179.93,
    "close": 180.0,
    "volume": 54163.0
  },
  {
    "Unnamed: 0.1": 1111,
    "Unnamed: 0": 1495,
    "time": 1684528500,
    "open": 180.0,
    "high": 180.02,
    "low": 179.96,
    "close": 180.0,
    "volume": 17206.0
  },
  {
    "Unnamed: 0.1": 1112,
    "Unnamed: 0": 1496,
    "time": 1684528800,
    "open": 180.0,
    "high": 180.14,
    "low": 179.95,
    "close": 179.96,
    "volume": 66182.0
  },
  {
    "Unnamed: 0.1": 1113,
    "Unnamed: 0": 1497,
    "time": 1684529100,
    "open": 179.98,
    "high": 180.08,
    "low": 179.96,
    "close": 179.98,
    "volume": 22559.0
  },
  {
    "Unnamed: 0.1": 1114,
    "Unnamed: 0": 1498,
    "time": 1684529400,
    "open": 179.98,
    "high": 180.03,
    "low": 179.98,
    "close": 180.02,
    "volume": 20939.0
  },
  {
    "Unnamed: 0.1": 1115,
    "Unnamed: 0": 1499,
    "time": 1684529700,
    "open": 180.0,
    "high": 180.02,
    "low": 179.97,
    "close": 179.98,
    "volume": 13955.0
  },
  {
    "Unnamed: 0.1": 1116,
    "Unnamed: 0": 1500,
    "time": 1684530000,
    "open": 179.98,
    "high": 180.02,
    "low": 179.97,
    "close": 180.02,
    "volume": 18204.0
  },
  {
    "Unnamed: 0.1": 1117,
    "Unnamed: 0": 1501,
    "time": 1684530300,
    "open": 180.02,
    "high": 180.02,
    "low": 179.97,
    "close": 179.99,
    "volume": 7540.0
  },
  {
    "Unnamed: 0.1": 1118,
    "Unnamed: 0": 1502,
    "time": 1684530600,
    "open": 179.99,
    "high": 180.0,
    "low": 179.98,
    "close": 179.98,
    "volume": 3459.0
  },
  {
    "Unnamed: 0.1": 1119,
    "Unnamed: 0": 1503,
    "time": 1684530900,
    "open": 180.0,
    "high": 180.0,
    "low": 179.99,
    "close": 179.99,
    "volume": 1605.0
  },
  {
    "Unnamed: 0.1": 1120,
    "Unnamed: 0": 1504,
    "time": 1684531200,
    "open": 180.0,
    "high": 180.0,
    "low": 179.97,
    "close": 179.98,
    "volume": 7755.0
  },
  {
    "Unnamed: 0.1": 1121,
    "Unnamed: 0": 1505,
    "time": 1684531500,
    "open": 179.98,
    "high": 180.0,
    "low": 179.97,
    "close": 179.99,
    "volume": 10989.0
  },
  {
    "Unnamed: 0.1": 1122,
    "Unnamed: 0": 1506,
    "time": 1684531800,
    "open": 179.99,
    "high": 180.0,
    "low": 179.97,
    "close": 179.97,
    "volume": 2389.0
  },
  {
    "Unnamed: 0.1": 1123,
    "Unnamed: 0": 1507,
    "time": 1684532100,
    "open": 179.98,
    "high": 180.0,
    "low": 179.98,
    "close": 179.99,
    "volume": 4968.0
  },
  {
    "Unnamed: 0.1": 1124,
    "Unnamed: 0": 1508,
    "time": 1684532400,
    "open": 179.98,
    "high": 180.0,
    "low": 179.97,
    "close": 179.98,
    "volume": 11766.0
  },
  {
    "Unnamed: 0.1": 1125,
    "Unnamed: 0": 1509,
    "time": 1684532700,
    "open": 179.98,
    "high": 179.99,
    "low": 179.9,
    "close": 179.91,
    "volume": 16034.0
  },
  {
    "Unnamed: 0.1": 1126,
    "Unnamed: 0": 1510,
    "time": 1684533000,
    "open": 179.91,
    "high": 179.97,
    "low": 179.91,
    "close": 179.92,
    "volume": 3352.0
  },
  {
    "Unnamed: 0.1": 1127,
    "Unnamed: 0": 1511,
    "time": 1684533300,
    "open": 179.91,
    "high": 179.97,
    "low": 179.91,
    "close": 179.96,
    "volume": 8246.0
  },
  {
    "Unnamed: 0.1": 1128,
    "Unnamed: 0": 1512,
    "time": 1684533600,
    "open": 179.95,
    "high": 179.95,
    "low": 179.91,
    "close": 179.91,
    "volume": 2005.0
  },
  {
    "Unnamed: 0.1": 1129,
    "Unnamed: 0": 1513,
    "time": 1684533900,
    "open": 179.91,
    "high": 179.91,
    "low": 179.85,
    "close": 179.89,
    "volume": 12487.0
  },
  {
    "Unnamed: 0.1": 1130,
    "Unnamed: 0": 1514,
    "time": 1684534200,
    "open": 179.88,
    "high": 179.93,
    "low": 179.88,
    "close": 179.93,
    "volume": 1399.0
  },
  {
    "Unnamed: 0.1": 1131,
    "Unnamed: 0": 1515,
    "time": 1684534500,
    "open": 179.95,
    "high": 180.0,
    "low": 179.93,
    "close": 180.0,
    "volume": 7539.0
  },
  {
    "Unnamed: 0.1": 1132,
    "Unnamed: 0": 1516,
    "time": 1684534800,
    "open": 179.98,
    "high": 180.02,
    "low": 179.96,
    "close": 180.0,
    "volume": 12563.0
  },
  {
    "Unnamed: 0.1": 1133,
    "Unnamed: 0": 1517,
    "time": 1684535100,
    "open": 180.01,
    "high": 180.01,
    "low": 179.99,
    "close": 179.99,
    "volume": 3170.0
  },
  {
    "Unnamed: 0.1": 1134,
    "Unnamed: 0": 1518,
    "time": 1684535400,
    "open": 180.01,
    "high": 180.04,
    "low": 180.01,
    "close": 180.04,
    "volume": 3185.0
  },
  {
    "Unnamed: 0.1": 1135,
    "Unnamed: 0": 1519,
    "time": 1684535700,
    "open": 180.01,
    "high": 180.06,
    "low": 180.01,
    "close": 180.04,
    "volume": 7706.0
  },
  {
    "Unnamed: 0.1": 1136,
    "Unnamed: 0": 1520,
    "time": 1684536000,
    "open": 180.04,
    "high": 180.04,
    "low": 180.02,
    "close": 180.04,
    "volume": 1506.0
  },
  {
    "Unnamed: 0.1": 1137,
    "Unnamed: 0": 1521,
    "time": 1684536300,
    "open": 180.05,
    "high": 180.09,
    "low": 180.02,
    "close": 180.09,
    "volume": 7994.0
  },
  {
    "Unnamed: 0.1": 1138,
    "Unnamed: 0": 1522,
    "time": 1684536600,
    "open": 180.07,
    "high": 180.1,
    "low": 180.05,
    "close": 180.09,
    "volume": 4519.0
  },
  {
    "Unnamed: 0.1": 1139,
    "Unnamed: 0": 1523,
    "time": 1684536900,
    "open": 180.09,
    "high": 180.12,
    "low": 180.08,
    "close": 180.12,
    "volume": 7456.0
  },
  {
    "Unnamed: 0.1": 1140,
    "Unnamed: 0": 1524,
    "time": 1684537200,
    "open": 180.1,
    "high": 180.14,
    "low": 180.09,
    "close": 180.11,
    "volume": 6288.0
  },
  {
    "Unnamed: 0.1": 1141,
    "Unnamed: 0": 1525,
    "time": 1684537500,
    "open": 180.13,
    "high": 180.14,
    "low": 180.12,
    "close": 180.14,
    "volume": 6530.0
  },
  {
    "Unnamed: 0.1": 1142,
    "Unnamed: 0": 1526,
    "time": 1684537800,
    "open": 180.13,
    "high": 180.14,
    "low": 180.07,
    "close": 180.14,
    "volume": 2957.0
  },
  {
    "Unnamed: 0.1": 1143,
    "Unnamed: 0": 1527,
    "time": 1684538100,
    "open": 180.14,
    "high": 180.14,
    "low": 180.1,
    "close": 180.1,
    "volume": 4158.0
  },
  {
    "Unnamed: 0.1": 1144,
    "Unnamed: 0": 1528,
    "time": 1684538400,
    "open": 180.1,
    "high": 180.14,
    "low": 180.07,
    "close": 180.11,
    "volume": 4882.0
  },
  {
    "Unnamed: 0.1": 1145,
    "Unnamed: 0": 1529,
    "time": 1684538700,
    "open": 180.1,
    "high": 180.14,
    "low": 180.1,
    "close": 180.12,
    "volume": 3002.0
  },
  {
    "Unnamed: 0.1": 1146,
    "Unnamed: 0": 1530,
    "time": 1684539000,
    "open": 180.13,
    "high": 180.14,
    "low": 180.03,
    "close": 180.04,
    "volume": 2794.0
  },
  {
    "Unnamed: 0.1": 1147,
    "Unnamed: 0": 1531,
    "time": 1684539300,
    "open": 180.04,
    "high": 180.14,
    "low": 180.04,
    "close": 180.12,
    "volume": 4024.0
  },
  {
    "Unnamed: 0.1": 1148,
    "Unnamed: 0": 1532,
    "time": 1684539600,
    "open": 180.11,
    "high": 180.11,
    "low": 180.0,
    "close": 180.05,
    "volume": 7256.0
  },
  {
    "Unnamed: 0.1": 1149,
    "Unnamed: 0": 1533,
    "time": 1684539900,
    "open": 180.05,
    "high": 180.09,
    "low": 180.04,
    "close": 180.04,
    "volume": 4019.0
  },
  {
    "Unnamed: 0.1": 1150,
    "Unnamed: 0": 1534,
    "time": 1684540200,
    "open": 180.04,
    "high": 180.05,
    "low": 179.9,
    "close": 180.0,
    "volume": 9959.0
  },
  {
    "Unnamed: 0.1": 1151,
    "Unnamed: 0": 1535,
    "time": 1684540500,
    "open": 179.99,
    "high": 180.04,
    "low": 179.92,
    "close": 180.0,
    "volume": 19560.0
  },
  {
    "Unnamed: 0.1": 1152,
    "Unnamed: 0": 1536,
    "time": 1684828800,
    "open": 188.3,
    "high": 189.39,
    "low": 188.0,
    "close": 188.67,
    "volume": 13713.0
  },
  {
    "Unnamed: 0.1": 1153,
    "Unnamed: 0": 1537,
    "time": 1684829100,
    "open": 188.64,
    "high": 188.81,
    "low": 188.25,
    "close": 188.25,
    "volume": 9895.0
  },
  {
    "Unnamed: 0.1": 1154,
    "Unnamed: 0": 1538,
    "time": 1684829400,
    "open": 188.3,
    "high": 188.3,
    "low": 187.7,
    "close": 187.7,
    "volume": 19496.0
  },
  {
    "Unnamed: 0.1": 1155,
    "Unnamed: 0": 1539,
    "time": 1684829700,
    "open": 187.82,
    "high": 187.89,
    "low": 187.3,
    "close": 187.3,
    "volume": 8960.0
  },
  {
    "Unnamed: 0.1": 1156,
    "Unnamed: 0": 1540,
    "time": 1684830000,
    "open": 187.26,
    "high": 187.3,
    "low": 187.05,
    "close": 187.3,
    "volume": 5900.0
  },
  {
    "Unnamed: 0.1": 1157,
    "Unnamed: 0": 1541,
    "time": 1684830300,
    "open": 187.36,
    "high": 187.72,
    "low": 187.36,
    "close": 187.72,
    "volume": 3660.0
  },
  {
    "Unnamed: 0.1": 1158,
    "Unnamed: 0": 1542,
    "time": 1684830600,
    "open": 187.84,
    "high": 187.86,
    "low": 187.73,
    "close": 187.77,
    "volume": 1615.0
  },
  {
    "Unnamed: 0.1": 1159,
    "Unnamed: 0": 1543,
    "time": 1684830900,
    "open": 187.69,
    "high": 187.69,
    "low": 187.35,
    "close": 187.35,
    "volume": 2604.0
  },
  {
    "Unnamed: 0.1": 1160,
    "Unnamed: 0": 1544,
    "time": 1684831200,
    "open": 187.3,
    "high": 187.35,
    "low": 187.2,
    "close": 187.3,
    "volume": 2087.0
  },
  {
    "Unnamed: 0.1": 1161,
    "Unnamed: 0": 1545,
    "time": 1684831500,
    "open": 187.38,
    "high": 187.5,
    "low": 187.38,
    "close": 187.44,
    "volume": 3338.0
  },
  {
    "Unnamed: 0.1": 1162,
    "Unnamed: 0": 1546,
    "time": 1684831800,
    "open": 187.45,
    "high": 187.62,
    "low": 187.45,
    "close": 187.45,
    "volume": 1343.0
  },
  {
    "Unnamed: 0.1": 1163,
    "Unnamed: 0": 1547,
    "time": 1684832100,
    "open": 187.4,
    "high": 187.45,
    "low": 187.37,
    "close": 187.37,
    "volume": 1296.0
  },
  {
    "Unnamed: 0.1": 1164,
    "Unnamed: 0": 1548,
    "time": 1684832400,
    "open": 187.44,
    "high": 187.75,
    "low": 187.43,
    "close": 187.6,
    "volume": 4610.0
  },
  {
    "Unnamed: 0.1": 1165,
    "Unnamed: 0": 1549,
    "time": 1684832700,
    "open": 187.72,
    "high": 187.72,
    "low": 187.68,
    "close": 187.68,
    "volume": 512.0
  },
  {
    "Unnamed: 0.1": 1166,
    "Unnamed: 0": 1550,
    "time": 1684833000,
    "open": 187.69,
    "high": 187.69,
    "low": 187.61,
    "close": 187.61,
    "volume": 1789.0
  },
  {
    "Unnamed: 0.1": 1167,
    "Unnamed: 0": 1551,
    "time": 1684833300,
    "open": 187.54,
    "high": 187.63,
    "low": 187.52,
    "close": 187.53,
    "volume": 1184.0
  },
  {
    "Unnamed: 0.1": 1168,
    "Unnamed: 0": 1552,
    "time": 1684833600,
    "open": 187.51,
    "high": 187.51,
    "low": 187.37,
    "close": 187.39,
    "volume": 4169.0
  },
  {
    "Unnamed: 0.1": 1169,
    "Unnamed: 0": 1553,
    "time": 1684833900,
    "open": 187.35,
    "high": 187.55,
    "low": 187.35,
    "close": 187.43,
    "volume": 1790.0
  },
  {
    "Unnamed: 0.1": 1170,
    "Unnamed: 0": 1554,
    "time": 1684834200,
    "open": 187.43,
    "high": 187.56,
    "low": 187.42,
    "close": 187.56,
    "volume": 1219.0
  },
  {
    "Unnamed: 0.1": 1171,
    "Unnamed: 0": 1555,
    "time": 1684834500,
    "open": 187.56,
    "high": 187.62,
    "low": 187.56,
    "close": 187.58,
    "volume": 1935.0
  },
  {
    "Unnamed: 0.1": 1172,
    "Unnamed: 0": 1556,
    "time": 1684834800,
    "open": 187.59,
    "high": 187.59,
    "low": 187.3,
    "close": 187.41,
    "volume": 3075.0
  },
  {
    "Unnamed: 0.1": 1173,
    "Unnamed: 0": 1557,
    "time": 1684835100,
    "open": 187.4,
    "high": 187.52,
    "low": 187.4,
    "close": 187.45,
    "volume": 4681.0
  },
  {
    "Unnamed: 0.1": 1174,
    "Unnamed: 0": 1558,
    "time": 1684835400,
    "open": 187.45,
    "high": 187.58,
    "low": 187.4,
    "close": 187.4,
    "volume": 2603.0
  },
  {
    "Unnamed: 0.1": 1175,
    "Unnamed: 0": 1559,
    "time": 1684835700,
    "open": 187.49,
    "high": 187.58,
    "low": 187.49,
    "close": 187.52,
    "volume": 796.0
  },
  {
    "Unnamed: 0.1": 1176,
    "Unnamed: 0": 1560,
    "time": 1684836000,
    "open": 187.52,
    "high": 187.52,
    "low": 187.37,
    "close": 187.5,
    "volume": 2419.0
  },
  {
    "Unnamed: 0.1": 1177,
    "Unnamed: 0": 1561,
    "time": 1684836300,
    "open": 187.58,
    "high": 187.73,
    "low": 187.57,
    "close": 187.72,
    "volume": 2960.0
  },
  {
    "Unnamed: 0.1": 1178,
    "Unnamed: 0": 1562,
    "time": 1684836600,
    "open": 187.7,
    "high": 187.8,
    "low": 187.7,
    "close": 187.78,
    "volume": 2384.0
  },
  {
    "Unnamed: 0.1": 1179,
    "Unnamed: 0": 1563,
    "time": 1684836900,
    "open": 187.76,
    "high": 187.93,
    "low": 187.76,
    "close": 187.9,
    "volume": 853.0
  },
  {
    "Unnamed: 0.1": 1180,
    "Unnamed: 0": 1564,
    "time": 1684837200,
    "open": 187.89,
    "high": 187.89,
    "low": 187.85,
    "close": 187.88,
    "volume": 1216.0
  },
  {
    "Unnamed: 0.1": 1181,
    "Unnamed: 0": 1565,
    "time": 1684837500,
    "open": 187.83,
    "high": 188.0,
    "low": 187.82,
    "close": 188.0,
    "volume": 2971.0
  },
  {
    "Unnamed: 0.1": 1182,
    "Unnamed: 0": 1566,
    "time": 1684837800,
    "open": 187.97,
    "high": 188.27,
    "low": 187.97,
    "close": 188.27,
    "volume": 6059.0
  },
  {
    "Unnamed: 0.1": 1183,
    "Unnamed: 0": 1567,
    "time": 1684838100,
    "open": 188.3,
    "high": 188.48,
    "low": 188.3,
    "close": 188.35,
    "volume": 6066.0
  },
  {
    "Unnamed: 0.1": 1184,
    "Unnamed: 0": 1568,
    "time": 1684838400,
    "open": 188.35,
    "high": 188.45,
    "low": 188.35,
    "close": 188.35,
    "volume": 2906.0
  },
  {
    "Unnamed: 0.1": 1185,
    "Unnamed: 0": 1569,
    "time": 1684838700,
    "open": 188.35,
    "high": 188.35,
    "low": 187.87,
    "close": 188.25,
    "volume": 4777.0
  },
  {
    "Unnamed: 0.1": 1186,
    "Unnamed: 0": 1570,
    "time": 1684839000,
    "open": 188.13,
    "high": 188.22,
    "low": 188.12,
    "close": 188.12,
    "volume": 2304.0
  },
  {
    "Unnamed: 0.1": 1187,
    "Unnamed: 0": 1571,
    "time": 1684839300,
    "open": 188.11,
    "high": 188.4,
    "low": 188.11,
    "close": 188.4,
    "volume": 4307.0
  },
  {
    "Unnamed: 0.1": 1188,
    "Unnamed: 0": 1572,
    "time": 1684839600,
    "open": 188.38,
    "high": 188.59,
    "low": 188.3,
    "close": 188.37,
    "volume": 24958.0
  },
  {
    "Unnamed: 0.1": 1189,
    "Unnamed: 0": 1573,
    "time": 1684839900,
    "open": 188.37,
    "high": 188.45,
    "low": 188.2,
    "close": 188.2,
    "volume": 19210.0
  },
  {
    "Unnamed: 0.1": 1190,
    "Unnamed: 0": 1574,
    "time": 1684840200,
    "open": 188.23,
    "high": 188.23,
    "low": 187.97,
    "close": 187.97,
    "volume": 36376.0
  },
  {
    "Unnamed: 0.1": 1191,
    "Unnamed: 0": 1575,
    "time": 1684840500,
    "open": 188.04,
    "high": 188.34,
    "low": 188.04,
    "close": 188.29,
    "volume": 11290.0
  },
  {
    "Unnamed: 0.1": 1192,
    "Unnamed: 0": 1576,
    "time": 1684840800,
    "open": 188.29,
    "high": 188.31,
    "low": 188.15,
    "close": 188.15,
    "volume": 6514.0
  },
  {
    "Unnamed: 0.1": 1193,
    "Unnamed: 0": 1577,
    "time": 1684841100,
    "open": 188.15,
    "high": 188.35,
    "low": 188.15,
    "close": 188.35,
    "volume": 12799.0
  },
  {
    "Unnamed: 0.1": 1194,
    "Unnamed: 0": 1578,
    "time": 1684841400,
    "open": 188.36,
    "high": 188.36,
    "low": 188.0,
    "close": 188.1,
    "volume": 16527.0
  },
  {
    "Unnamed: 0.1": 1195,
    "Unnamed: 0": 1579,
    "time": 1684841700,
    "open": 188.09,
    "high": 188.1,
    "low": 187.9,
    "close": 188.0,
    "volume": 11334.0
  },
  {
    "Unnamed: 0.1": 1196,
    "Unnamed: 0": 1580,
    "time": 1684842000,
    "open": 188.0,
    "high": 188.01,
    "low": 187.8,
    "close": 187.94,
    "volume": 10455.0
  },
  {
    "Unnamed: 0.1": 1197,
    "Unnamed: 0": 1581,
    "time": 1684842300,
    "open": 187.94,
    "high": 188.01,
    "low": 187.65,
    "close": 187.65,
    "volume": 13567.0
  },
  {
    "Unnamed: 0.1": 1198,
    "Unnamed: 0": 1582,
    "time": 1684842600,
    "open": 187.65,
    "high": 187.75,
    "low": 187.4,
    "close": 187.4,
    "volume": 26510.0
  },
  {
    "Unnamed: 0.1": 1199,
    "Unnamed: 0": 1583,
    "time": 1684842900,
    "open": 187.42,
    "high": 187.65,
    "low": 187.4,
    "close": 187.45,
    "volume": 16182.0
  },
  {
    "Unnamed: 0.1": 1200,
    "Unnamed: 0": 1584,
    "time": 1684843200,
    "open": 188.37,
    "high": 189.0,
    "low": 187.16,
    "close": 187.71,
    "volume": 206298.0
  },
  {
    "Unnamed: 0.1": 1201,
    "Unnamed: 0": 1585,
    "time": 1684843500,
    "open": 187.71,
    "high": 187.86,
    "low": 187.65,
    "close": 187.79,
    "volume": 37381.0
  },
  {
    "Unnamed: 0.1": 1202,
    "Unnamed: 0": 1586,
    "time": 1684843800,
    "open": 187.77,
    "high": 187.87,
    "low": 187.63,
    "close": 187.7,
    "volume": 25854.0
  },
  {
    "Unnamed: 0.1": 1203,
    "Unnamed: 0": 1587,
    "time": 1684844100,
    "open": 187.63,
    "high": 187.69,
    "low": 187.43,
    "close": 187.55,
    "volume": 25108.0
  },
  {
    "Unnamed: 0.1": 1204,
    "Unnamed: 0": 1588,
    "time": 1684844400,
    "open": 187.58,
    "high": 187.75,
    "low": 187.5,
    "close": 187.7,
    "volume": 12349.0
  },
  {
    "Unnamed: 0.1": 1205,
    "Unnamed: 0": 1589,
    "time": 1684844700,
    "open": 187.69,
    "high": 187.77,
    "low": 187.66,
    "close": 187.73,
    "volume": 13246.0
  },
  {
    "Unnamed: 0.1": 1206,
    "Unnamed: 0": 1590,
    "time": 1684845000,
    "open": 187.75,
    "high": 187.79,
    "low": 187.54,
    "close": 187.56,
    "volume": 37676.0
  },
  {
    "Unnamed: 0.1": 1207,
    "Unnamed: 0": 1591,
    "time": 1684845300,
    "open": 187.57,
    "high": 187.6,
    "low": 187.37,
    "close": 187.58,
    "volume": 38517.0
  },
  {
    "Unnamed: 0.1": 1208,
    "Unnamed: 0": 1592,
    "time": 1684845600,
    "open": 187.56,
    "high": 187.6,
    "low": 187.2,
    "close": 187.2,
    "volume": 46866.0
  },
  {
    "Unnamed: 0.1": 1209,
    "Unnamed: 0": 1593,
    "time": 1684845900,
    "open": 187.2,
    "high": 187.26,
    "low": 187.11,
    "close": 187.14,
    "volume": 50407.0
  },
  {
    "Unnamed: 0.1": 1210,
    "Unnamed: 0": 1594,
    "time": 1684846200,
    "open": 187.11,
    "high": 187.32,
    "low": 187.04,
    "close": 187.22,
    "volume": 53178.0
  },
  {
    "Unnamed: 0.1": 1211,
    "Unnamed: 0": 1595,
    "time": 1684846500,
    "open": 187.28,
    "high": 187.28,
    "low": 186.78,
    "close": 186.87,
    "volume": 110903.0
  },
  {
    "Unnamed: 0.1": 1212,
    "Unnamed: 0": 1596,
    "time": 1684846800,
    "open": 186.85,
    "high": 187.1,
    "low": 186.76,
    "close": 186.85,
    "volume": 68367.0
  },
  {
    "Unnamed: 0.1": 1213,
    "Unnamed: 0": 1597,
    "time": 1684847100,
    "open": 186.83,
    "high": 186.89,
    "low": 186.76,
    "close": 186.85,
    "volume": 52908.0
  },
  {
    "Unnamed: 0.1": 1214,
    "Unnamed: 0": 1598,
    "time": 1684847400,
    "open": 186.82,
    "high": 186.82,
    "low": 186.44,
    "close": 186.49,
    "volume": 98095.0
  },
  {
    "Unnamed: 0.1": 1215,
    "Unnamed: 0": 1599,
    "time": 1684847700,
    "open": 186.47,
    "high": 188.87,
    "low": 186.46,
    "close": 186.7,
    "volume": 63797.0
  },
  {
    "Unnamed: 0.1": 1216,
    "Unnamed: 0": 1600,
    "time": 1684848000,
    "open": 186.68,
    "high": 186.68,
    "low": 186.26,
    "close": 186.37,
    "volume": 87492.0
  },
  {
    "Unnamed: 0.1": 1217,
    "Unnamed: 0": 1601,
    "time": 1684848300,
    "open": 186.38,
    "high": 186.5,
    "low": 186.07,
    "close": 186.2,
    "volume": 72388.0
  },
  {
    "Unnamed: 0.1": 1218,
    "Unnamed: 0": 1602,
    "time": 1684848600,
    "open": 186.2,
    "high": 188.16,
    "low": 186.06,
    "close": 187.9,
    "volume": 3707942.0
  },
  {
    "Unnamed: 0.1": 1219,
    "Unnamed: 0": 1603,
    "time": 1684848900,
    "open": 187.87,
    "high": 188.4,
    "low": 187.01,
    "close": 187.87,
    "volume": 3006749.0
  },
  {
    "Unnamed: 0.1": 1220,
    "Unnamed: 0": 1604,
    "time": 1684849200,
    "open": 187.89,
    "high": 189.55,
    "low": 187.63,
    "close": 189.36,
    "volume": 3149770.0
  },
  {
    "Unnamed: 0.1": 1221,
    "Unnamed: 0": 1605,
    "time": 1684849500,
    "open": 189.35,
    "high": 191.42,
    "low": 189.3,
    "close": 191.41,
    "volume": 4674401.0
  },
  {
    "Unnamed: 0.1": 1222,
    "Unnamed: 0": 1606,
    "time": 1684849800,
    "open": 191.41,
    "high": 191.98,
    "low": 190.88,
    "close": 191.75,
    "volume": 3314354.0
  },
  {
    "Unnamed: 0.1": 1223,
    "Unnamed: 0": 1607,
    "time": 1684850100,
    "open": 191.75,
    "high": 192.0,
    "low": 191.03,
    "close": 191.17,
    "volume": 3183074.0
  },
  {
    "Unnamed: 0.1": 1224,
    "Unnamed: 0": 1608,
    "time": 1684850400,
    "open": 191.15,
    "high": 191.61,
    "low": 190.02,
    "close": 190.06,
    "volume": 2954660.0
  },
  {
    "Unnamed: 0.1": 1225,
    "Unnamed: 0": 1609,
    "time": 1684850700,
    "open": 190.07,
    "high": 191.19,
    "low": 189.88,
    "close": 191.19,
    "volume": 2716697.0
  },
  {
    "Unnamed: 0.1": 1226,
    "Unnamed: 0": 1610,
    "time": 1684851000,
    "open": 191.2,
    "high": 191.43,
    "low": 190.58,
    "close": 190.72,
    "volume": 2076977.0
  },
  {
    "Unnamed: 0.1": 1227,
    "Unnamed: 0": 1611,
    "time": 1684851300,
    "open": 190.7,
    "high": 191.06,
    "low": 190.0,
    "close": 190.7,
    "volume": 1894819.0
  },
  {
    "Unnamed: 0.1": 1228,
    "Unnamed: 0": 1612,
    "time": 1684851600,
    "open": 190.71,
    "high": 191.18,
    "low": 190.3,
    "close": 190.8,
    "volume": 1988275.0
  },
  {
    "Unnamed: 0.1": 1229,
    "Unnamed: 0": 1613,
    "time": 1684851900,
    "open": 190.81,
    "high": 191.75,
    "low": 190.75,
    "close": 191.68,
    "volume": 2023702.0
  },
  {
    "Unnamed: 0.1": 1230,
    "Unnamed: 0": 1614,
    "time": 1684852200,
    "open": 191.68,
    "high": 191.76,
    "low": 190.92,
    "close": 191.42,
    "volume": 1816462.0
  },
  {
    "Unnamed: 0.1": 1231,
    "Unnamed: 0": 1615,
    "time": 1684852500,
    "open": 191.42,
    "high": 192.5,
    "low": 191.04,
    "close": 192.44,
    "volume": 2631413.0
  },
  {
    "Unnamed: 0.1": 1232,
    "Unnamed: 0": 1616,
    "time": 1684852800,
    "open": 192.43,
    "high": 192.89,
    "low": 192.25,
    "close": 192.89,
    "volume": 2502580.0
  },
  {
    "Unnamed: 0.1": 1233,
    "Unnamed: 0": 1617,
    "time": 1684853100,
    "open": 192.88,
    "high": 192.96,
    "low": 192.11,
    "close": 192.24,
    "volume": 1925409.0
  },
  {
    "Unnamed: 0.1": 1234,
    "Unnamed: 0": 1618,
    "time": 1684853400,
    "open": 192.24,
    "high": 192.24,
    "low": 191.36,
    "close": 191.75,
    "volume": 1862278.0
  },
  {
    "Unnamed: 0.1": 1235,
    "Unnamed: 0": 1619,
    "time": 1684853700,
    "open": 191.73,
    "high": 191.93,
    "low": 191.16,
    "close": 191.65,
    "volume": 1480252.0
  },
  {
    "Unnamed: 0.1": 1236,
    "Unnamed: 0": 1620,
    "time": 1684854000,
    "open": 191.64,
    "high": 192.02,
    "low": 191.6,
    "close": 191.82,
    "volume": 1295629.0
  },
  {
    "Unnamed: 0.1": 1237,
    "Unnamed: 0": 1621,
    "time": 1684854300,
    "open": 191.81,
    "high": 192.42,
    "low": 191.59,
    "close": 192.0,
    "volume": 1474900.0
  },
  {
    "Unnamed: 0.1": 1238,
    "Unnamed: 0": 1622,
    "time": 1684854600,
    "open": 192.0,
    "high": 192.02,
    "low": 191.24,
    "close": 191.27,
    "volume": 1387003.0
  },
  {
    "Unnamed: 0.1": 1239,
    "Unnamed: 0": 1623,
    "time": 1684854900,
    "open": 191.25,
    "high": 191.48,
    "low": 190.76,
    "close": 190.97,
    "volume": 1750880.0
  },
  {
    "Unnamed: 0.1": 1240,
    "Unnamed: 0": 1624,
    "time": 1684855200,
    "open": 191.0,
    "high": 191.33,
    "low": 190.77,
    "close": 191.03,
    "volume": 1321287.0
  },
  {
    "Unnamed: 0.1": 1241,
    "Unnamed: 0": 1625,
    "time": 1684855500,
    "open": 190.99,
    "high": 191.32,
    "low": 190.63,
    "close": 191.21,
    "volume": 1490544.0
  },
  {
    "Unnamed: 0.1": 1242,
    "Unnamed: 0": 1626,
    "time": 1684855800,
    "open": 191.22,
    "high": 191.24,
    "low": 190.84,
    "close": 190.98,
    "volume": 900125.0
  },
  {
    "Unnamed: 0.1": 1243,
    "Unnamed: 0": 1627,
    "time": 1684856100,
    "open": 190.98,
    "high": 190.98,
    "low": 190.23,
    "close": 190.37,
    "volume": 1735395.0
  },
  {
    "Unnamed: 0.1": 1244,
    "Unnamed: 0": 1628,
    "time": 1684856400,
    "open": 190.38,
    "high": 190.67,
    "low": 189.96,
    "close": 190.06,
    "volume": 1199575.0
  },
  {
    "Unnamed: 0.1": 1245,
    "Unnamed: 0": 1629,
    "time": 1684856700,
    "open": 190.06,
    "high": 190.3,
    "low": 189.44,
    "close": 189.69,
    "volume": 1758196.0
  },
  {
    "Unnamed: 0.1": 1246,
    "Unnamed: 0": 1630,
    "time": 1684857000,
    "open": 189.71,
    "high": 189.83,
    "low": 188.96,
    "close": 189.4,
    "volume": 1758380.0
  },
  {
    "Unnamed: 0.1": 1247,
    "Unnamed: 0": 1631,
    "time": 1684857300,
    "open": 189.4,
    "high": 190.16,
    "low": 189.3,
    "close": 190.03,
    "volume": 1700565.0
  },
  {
    "Unnamed: 0.1": 1248,
    "Unnamed: 0": 1632,
    "time": 1684857600,
    "open": 190.04,
    "high": 190.22,
    "low": 189.33,
    "close": 189.48,
    "volume": 1274404.0
  },
  {
    "Unnamed: 0.1": 1249,
    "Unnamed: 0": 1633,
    "time": 1684857900,
    "open": 189.46,
    "high": 189.7,
    "low": 188.98,
    "close": 189.5,
    "volume": 1367774.0
  },
  {
    "Unnamed: 0.1": 1250,
    "Unnamed: 0": 1634,
    "time": 1684858200,
    "open": 189.51,
    "high": 189.58,
    "low": 189.02,
    "close": 189.4,
    "volume": 1202054.0
  },
  {
    "Unnamed: 0.1": 1251,
    "Unnamed: 0": 1635,
    "time": 1684858500,
    "open": 189.4,
    "high": 189.73,
    "low": 188.88,
    "close": 189.32,
    "volume": 1306057.0
  },
  {
    "Unnamed: 0.1": 1252,
    "Unnamed: 0": 1636,
    "time": 1684858800,
    "open": 189.32,
    "high": 189.44,
    "low": 189.04,
    "close": 189.32,
    "volume": 1010163.0
  },
  {
    "Unnamed: 0.1": 1253,
    "Unnamed: 0": 1637,
    "time": 1684859100,
    "open": 189.33,
    "high": 189.33,
    "low": 187.93,
    "close": 188.01,
    "volume": 2089114.0
  },
  {
    "Unnamed: 0.1": 1254,
    "Unnamed: 0": 1638,
    "time": 1684859400,
    "open": 188.01,
    "high": 188.04,
    "low": 186.89,
    "close": 186.94,
    "volume": 2432770.0
  },
  {
    "Unnamed: 0.1": 1255,
    "Unnamed: 0": 1639,
    "time": 1684859700,
    "open": 186.96,
    "high": 187.04,
    "low": 186.41,
    "close": 186.97,
    "volume": 2447194.0
  },
  {
    "Unnamed: 0.1": 1256,
    "Unnamed: 0": 1640,
    "time": 1684860000,
    "open": 186.98,
    "high": 187.1,
    "low": 186.43,
    "close": 186.66,
    "volume": 1882756.0
  },
  {
    "Unnamed: 0.1": 1257,
    "Unnamed: 0": 1641,
    "time": 1684860300,
    "open": 186.64,
    "high": 187.14,
    "low": 186.2,
    "close": 186.76,
    "volume": 1840169.0
  },
  {
    "Unnamed: 0.1": 1258,
    "Unnamed: 0": 1642,
    "time": 1684860600,
    "open": 186.77,
    "high": 187.51,
    "low": 186.67,
    "close": 187.33,
    "volume": 1780724.0
  },
  {
    "Unnamed: 0.1": 1259,
    "Unnamed: 0": 1643,
    "time": 1684860900,
    "open": 187.33,
    "high": 187.97,
    "low": 187.26,
    "close": 187.73,
    "volume": 1827817.0
  },
  {
    "Unnamed: 0.1": 1260,
    "Unnamed: 0": 1644,
    "time": 1684861200,
    "open": 187.73,
    "high": 188.09,
    "low": 187.53,
    "close": 187.54,
    "volume": 1204065.0
  },
  {
    "Unnamed: 0.1": 1261,
    "Unnamed: 0": 1645,
    "time": 1684861500,
    "open": 187.53,
    "high": 188.59,
    "low": 187.32,
    "close": 188.47,
    "volume": 1796417.0
  },
  {
    "Unnamed: 0.1": 1262,
    "Unnamed: 0": 1646,
    "time": 1684861800,
    "open": 188.49,
    "high": 188.83,
    "low": 188.2,
    "close": 188.69,
    "volume": 1440464.0
  },
  {
    "Unnamed: 0.1": 1263,
    "Unnamed: 0": 1647,
    "time": 1684862100,
    "open": 188.68,
    "high": 189.19,
    "low": 188.55,
    "close": 188.95,
    "volume": 1561169.0
  },
  {
    "Unnamed: 0.1": 1264,
    "Unnamed: 0": 1648,
    "time": 1684862400,
    "open": 188.93,
    "high": 189.0,
    "low": 188.48,
    "close": 188.74,
    "volume": 1094704.0
  },
  {
    "Unnamed: 0.1": 1265,
    "Unnamed: 0": 1649,
    "time": 1684862700,
    "open": 188.75,
    "high": 188.88,
    "low": 187.37,
    "close": 187.51,
    "volume": 1785950.0
  },
  {
    "Unnamed: 0.1": 1266,
    "Unnamed: 0": 1650,
    "time": 1684863000,
    "open": 187.5,
    "high": 187.5,
    "low": 186.83,
    "close": 186.92,
    "volume": 1721133.0
  },
  {
    "Unnamed: 0.1": 1267,
    "Unnamed: 0": 1651,
    "time": 1684863300,
    "open": 186.93,
    "high": 187.41,
    "low": 186.82,
    "close": 187.13,
    "volume": 1190708.0
  },
  {
    "Unnamed: 0.1": 1268,
    "Unnamed: 0": 1652,
    "time": 1684863600,
    "open": 187.12,
    "high": 187.77,
    "low": 187.1,
    "close": 187.66,
    "volume": 1101317.0
  },
  {
    "Unnamed: 0.1": 1269,
    "Unnamed: 0": 1653,
    "time": 1684863900,
    "open": 187.66,
    "high": 187.83,
    "low": 186.62,
    "close": 186.82,
    "volume": 1301273.0
  },
  {
    "Unnamed: 0.1": 1270,
    "Unnamed: 0": 1654,
    "time": 1684864200,
    "open": 186.81,
    "high": 186.81,
    "low": 186.14,
    "close": 186.63,
    "volume": 1615068.0
  },
  {
    "Unnamed: 0.1": 1271,
    "Unnamed: 0": 1655,
    "time": 1684864500,
    "open": 186.62,
    "high": 186.74,
    "low": 186.39,
    "close": 186.52,
    "volume": 939087.0
  },
  {
    "Unnamed: 0.1": 1272,
    "Unnamed: 0": 1656,
    "time": 1684864800,
    "open": 186.53,
    "high": 187.09,
    "low": 186.32,
    "close": 187.02,
    "volume": 1234458.0
  },
  {
    "Unnamed: 0.1": 1273,
    "Unnamed: 0": 1657,
    "time": 1684865100,
    "open": 187.05,
    "high": 187.55,
    "low": 187.01,
    "close": 187.35,
    "volume": 1281140.0
  },
  {
    "Unnamed: 0.1": 1274,
    "Unnamed: 0": 1658,
    "time": 1684865400,
    "open": 187.35,
    "high": 187.59,
    "low": 186.62,
    "close": 186.84,
    "volume": 1150430.0
  },
  {
    "Unnamed: 0.1": 1275,
    "Unnamed: 0": 1659,
    "time": 1684865700,
    "open": 186.81,
    "high": 186.98,
    "low": 186.4,
    "close": 186.71,
    "volume": 1205067.0
  },
  {
    "Unnamed: 0.1": 1276,
    "Unnamed: 0": 1660,
    "time": 1684866000,
    "open": 186.71,
    "high": 186.81,
    "low": 185.62,
    "close": 185.64,
    "volume": 1891952.0
  },
  {
    "Unnamed: 0.1": 1277,
    "Unnamed: 0": 1661,
    "time": 1684866300,
    "open": 185.66,
    "high": 186.35,
    "low": 185.57,
    "close": 186.13,
    "volume": 1376028.0
  },
  {
    "Unnamed: 0.1": 1278,
    "Unnamed: 0": 1662,
    "time": 1684866600,
    "open": 186.15,
    "high": 186.64,
    "low": 186.05,
    "close": 186.42,
    "volume": 1182627.0
  },
  {
    "Unnamed: 0.1": 1279,
    "Unnamed: 0": 1663,
    "time": 1684866900,
    "open": 186.4,
    "high": 186.53,
    "low": 185.78,
    "close": 186.07,
    "volume": 1330260.0
  },
  {
    "Unnamed: 0.1": 1280,
    "Unnamed: 0": 1664,
    "time": 1684867200,
    "open": 186.06,
    "high": 186.48,
    "low": 185.86,
    "close": 186.33,
    "volume": 1113607.0
  },
  {
    "Unnamed: 0.1": 1281,
    "Unnamed: 0": 1665,
    "time": 1684867500,
    "open": 186.32,
    "high": 186.69,
    "low": 186.16,
    "close": 186.44,
    "volume": 1115850.0
  },
  {
    "Unnamed: 0.1": 1282,
    "Unnamed: 0": 1666,
    "time": 1684867800,
    "open": 186.43,
    "high": 186.88,
    "low": 186.4,
    "close": 186.69,
    "volume": 1066188.0
  },
  {
    "Unnamed: 0.1": 1283,
    "Unnamed: 0": 1667,
    "time": 1684868100,
    "open": 186.7,
    "high": 186.85,
    "low": 186.56,
    "close": 186.78,
    "volume": 759300.0
  },
  {
    "Unnamed: 0.1": 1284,
    "Unnamed: 0": 1668,
    "time": 1684868400,
    "open": 186.78,
    "high": 187.0,
    "low": 186.68,
    "close": 186.98,
    "volume": 1028922.0
  },
  {
    "Unnamed: 0.1": 1285,
    "Unnamed: 0": 1669,
    "time": 1684868700,
    "open": 186.97,
    "high": 187.02,
    "low": 186.01,
    "close": 186.37,
    "volume": 1500453.0
  },
  {
    "Unnamed: 0.1": 1286,
    "Unnamed: 0": 1670,
    "time": 1684869000,
    "open": 186.34,
    "high": 186.75,
    "low": 186.09,
    "close": 186.63,
    "volume": 1282585.0
  },
  {
    "Unnamed: 0.1": 1287,
    "Unnamed: 0": 1671,
    "time": 1684869300,
    "open": 186.61,
    "high": 186.71,
    "low": 185.28,
    "close": 185.34,
    "volume": 1680906.0
  },
  {
    "Unnamed: 0.1": 1288,
    "Unnamed: 0": 1672,
    "time": 1684869600,
    "open": 185.34,
    "high": 185.86,
    "low": 185.26,
    "close": 185.76,
    "volume": 1499299.0
  },
  {
    "Unnamed: 0.1": 1289,
    "Unnamed: 0": 1673,
    "time": 1684869900,
    "open": 185.76,
    "high": 185.99,
    "low": 185.47,
    "close": 185.84,
    "volume": 1283853.0
  },
  {
    "Unnamed: 0.1": 1290,
    "Unnamed: 0": 1674,
    "time": 1684870200,
    "open": 185.87,
    "high": 186.32,
    "low": 185.84,
    "close": 186.06,
    "volume": 1058050.0
  },
  {
    "Unnamed: 0.1": 1291,
    "Unnamed: 0": 1675,
    "time": 1684870500,
    "open": 186.06,
    "high": 186.17,
    "low": 185.86,
    "close": 185.96,
    "volume": 856440.0
  },
  {
    "Unnamed: 0.1": 1292,
    "Unnamed: 0": 1676,
    "time": 1684870800,
    "open": 185.95,
    "high": 186.07,
    "low": 185.75,
    "close": 186.05,
    "volume": 971895.0
  },
  {
    "Unnamed: 0.1": 1293,
    "Unnamed: 0": 1677,
    "time": 1684871100,
    "open": 186.05,
    "high": 186.4,
    "low": 185.96,
    "close": 186.23,
    "volume": 1127329.0
  },
  {
    "Unnamed: 0.1": 1294,
    "Unnamed: 0": 1678,
    "time": 1684871400,
    "open": 186.24,
    "high": 186.34,
    "low": 185.71,
    "close": 185.86,
    "volume": 1343915.0
  },
  {
    "Unnamed: 0.1": 1295,
    "Unnamed: 0": 1679,
    "time": 1684871700,
    "open": 185.83,
    "high": 186.03,
    "low": 185.67,
    "close": 185.77,
    "volume": 1443980.0
  },
  {
    "Unnamed: 0.1": 1296,
    "Unnamed: 0": 1680,
    "time": 1684872000,
    "open": 185.77,
    "high": 185.95,
    "low": 185.5,
    "close": 185.5,
    "volume": 1368282.0
  },
  {
    "Unnamed: 0.1": 1297,
    "Unnamed: 0": 1681,
    "time": 1684872300,
    "open": 185.52,
    "high": 185.77,
    "low": 185.1,
    "close": 185.3,
    "volume": 75176.0
  },
  {
    "Unnamed: 0.1": 1298,
    "Unnamed: 0": 1682,
    "time": 1684872600,
    "open": 185.39,
    "high": 185.77,
    "low": 185.3,
    "close": 185.4,
    "volume": 30348.0
  },
  {
    "Unnamed: 0.1": 1299,
    "Unnamed: 0": 1683,
    "time": 1684872900,
    "open": 185.41,
    "high": 185.49,
    "low": 185.3,
    "close": 185.31,
    "volume": 24718.0
  },
  {
    "Unnamed: 0.1": 1300,
    "Unnamed: 0": 1684,
    "time": 1684873200,
    "open": 185.32,
    "high": 185.33,
    "low": 185.25,
    "close": 185.28,
    "volume": 26816.0
  },
  {
    "Unnamed: 0.1": 1301,
    "Unnamed: 0": 1685,
    "time": 1684873500,
    "open": 185.28,
    "high": 185.3,
    "low": 185.18,
    "close": 185.22,
    "volume": 19914.0
  },
  {
    "Unnamed: 0.1": 1302,
    "Unnamed: 0": 1686,
    "time": 1684873800,
    "open": 185.21,
    "high": 185.21,
    "low": 185.11,
    "close": 185.2,
    "volume": 19620.0
  },
  {
    "Unnamed: 0.1": 1303,
    "Unnamed: 0": 1687,
    "time": 1684874100,
    "open": 185.14,
    "high": 185.3,
    "low": 185.11,
    "close": 185.27,
    "volume": 20649.0
  },
  {
    "Unnamed: 0.1": 1304,
    "Unnamed: 0": 1688,
    "time": 1684874400,
    "open": 185.25,
    "high": 185.34,
    "low": 185.25,
    "close": 185.34,
    "volume": 12343.0
  },
  {
    "Unnamed: 0.1": 1305,
    "Unnamed: 0": 1689,
    "time": 1684874700,
    "open": 185.35,
    "high": 185.35,
    "low": 185.28,
    "close": 185.33,
    "volume": 11066.0
  },
  {
    "Unnamed: 0.1": 1306,
    "Unnamed: 0": 1690,
    "time": 1684875000,
    "open": 185.34,
    "high": 185.34,
    "low": 185.24,
    "close": 185.3,
    "volume": 27934.0
  },
  {
    "Unnamed: 0.1": 1307,
    "Unnamed: 0": 1691,
    "time": 1684875300,
    "open": 185.3,
    "high": 185.34,
    "low": 185.26,
    "close": 185.33,
    "volume": 16509.0
  },
  {
    "Unnamed: 0.1": 1308,
    "Unnamed: 0": 1692,
    "time": 1684875600,
    "open": 185.29,
    "high": 185.33,
    "low": 185.2,
    "close": 185.2,
    "volume": 8202.0
  },
  {
    "Unnamed: 0.1": 1309,
    "Unnamed: 0": 1693,
    "time": 1684875900,
    "open": 185.2,
    "high": 185.25,
    "low": 185.11,
    "close": 185.14,
    "volume": 12411.0
  },
  {
    "Unnamed: 0.1": 1310,
    "Unnamed: 0": 1694,
    "time": 1684876200,
    "open": 185.13,
    "high": 185.16,
    "low": 185.08,
    "close": 185.09,
    "volume": 19632.0
  },
  {
    "Unnamed: 0.1": 1311,
    "Unnamed: 0": 1695,
    "time": 1684876500,
    "open": 185.1,
    "high": 185.1,
    "low": 184.71,
    "close": 184.83,
    "volume": 59358.0
  },
  {
    "Unnamed: 0.1": 1312,
    "Unnamed: 0": 1696,
    "time": 1684876800,
    "open": 184.8,
    "high": 184.99,
    "low": 184.76,
    "close": 184.86,
    "volume": 27102.0
  },
  {
    "Unnamed: 0.1": 1313,
    "Unnamed: 0": 1697,
    "time": 1684877100,
    "open": 184.84,
    "high": 184.93,
    "low": 184.81,
    "close": 184.93,
    "volume": 12499.0
  },
  {
    "Unnamed: 0.1": 1314,
    "Unnamed: 0": 1698,
    "time": 1684877400,
    "open": 184.88,
    "high": 185.07,
    "low": 184.85,
    "close": 184.92,
    "volume": 20270.0
  },
  {
    "Unnamed: 0.1": 1315,
    "Unnamed: 0": 1699,
    "time": 1684877700,
    "open": 184.91,
    "high": 184.99,
    "low": 184.82,
    "close": 184.83,
    "volume": 10034.0
  },
  {
    "Unnamed: 0.1": 1316,
    "Unnamed: 0": 1700,
    "time": 1684878000,
    "open": 184.85,
    "high": 184.89,
    "low": 184.7,
    "close": 184.75,
    "volume": 13171.0
  },
  {
    "Unnamed: 0.1": 1317,
    "Unnamed: 0": 1701,
    "time": 1684878300,
    "open": 184.7,
    "high": 184.83,
    "low": 184.66,
    "close": 184.66,
    "volume": 10909.0
  },
  {
    "Unnamed: 0.1": 1318,
    "Unnamed: 0": 1702,
    "time": 1684878600,
    "open": 184.66,
    "high": 184.7,
    "low": 184.63,
    "close": 184.68,
    "volume": 10772.0
  },
  {
    "Unnamed: 0.1": 1319,
    "Unnamed: 0": 1703,
    "time": 1684878900,
    "open": 184.68,
    "high": 184.74,
    "low": 184.63,
    "close": 184.66,
    "volume": 13868.0
  },
  {
    "Unnamed: 0.1": 1320,
    "Unnamed: 0": 1704,
    "time": 1684879200,
    "open": 184.66,
    "high": 184.8,
    "low": 184.64,
    "close": 184.77,
    "volume": 19796.0
  },
  {
    "Unnamed: 0.1": 1321,
    "Unnamed: 0": 1705,
    "time": 1684879500,
    "open": 184.8,
    "high": 184.95,
    "low": 184.75,
    "close": 184.95,
    "volume": 15974.0
  },
  {
    "Unnamed: 0.1": 1322,
    "Unnamed: 0": 1706,
    "time": 1684879800,
    "open": 184.97,
    "high": 185.16,
    "low": 184.93,
    "close": 185.12,
    "volume": 21448.0
  },
  {
    "Unnamed: 0.1": 1323,
    "Unnamed: 0": 1707,
    "time": 1684880100,
    "open": 185.15,
    "high": 185.15,
    "low": 185.01,
    "close": 185.08,
    "volume": 6536.0
  },
  {
    "Unnamed: 0.1": 1324,
    "Unnamed: 0": 1708,
    "time": 1684880400,
    "open": 185.09,
    "high": 185.1,
    "low": 185.05,
    "close": 185.05,
    "volume": 6013.0
  },
  {
    "Unnamed: 0.1": 1325,
    "Unnamed: 0": 1709,
    "time": 1684880700,
    "open": 185.05,
    "high": 185.08,
    "low": 185.0,
    "close": 185.01,
    "volume": 5531.0
  },
  {
    "Unnamed: 0.1": 1326,
    "Unnamed: 0": 1710,
    "time": 1684881000,
    "open": 185.03,
    "high": 185.04,
    "low": 184.92,
    "close": 184.95,
    "volume": 11186.0
  },
  {
    "Unnamed: 0.1": 1327,
    "Unnamed: 0": 1711,
    "time": 1684881300,
    "open": 184.94,
    "high": 184.96,
    "low": 184.85,
    "close": 184.9,
    "volume": 9857.0
  },
  {
    "Unnamed: 0.1": 1328,
    "Unnamed: 0": 1712,
    "time": 1684881600,
    "open": 184.92,
    "high": 184.99,
    "low": 184.87,
    "close": 184.87,
    "volume": 7265.0
  },
  {
    "Unnamed: 0.1": 1329,
    "Unnamed: 0": 1713,
    "time": 1684881900,
    "open": 184.93,
    "high": 185.04,
    "low": 184.9,
    "close": 185.01,
    "volume": 8128.0
  },
  {
    "Unnamed: 0.1": 1330,
    "Unnamed: 0": 1714,
    "time": 1684882200,
    "open": 185.01,
    "high": 185.05,
    "low": 185.0,
    "close": 185.03,
    "volume": 10599.0
  },
  {
    "Unnamed: 0.1": 1331,
    "Unnamed: 0": 1715,
    "time": 1684882500,
    "open": 185.02,
    "high": 185.09,
    "low": 185.02,
    "close": 185.09,
    "volume": 7601.0
  },
  {
    "Unnamed: 0.1": 1332,
    "Unnamed: 0": 1716,
    "time": 1684882800,
    "open": 185.08,
    "high": 185.09,
    "low": 184.98,
    "close": 185.0,
    "volume": 15021.0
  },
  {
    "Unnamed: 0.1": 1333,
    "Unnamed: 0": 1717,
    "time": 1684883100,
    "open": 184.99,
    "high": 185.0,
    "low": 184.95,
    "close": 184.95,
    "volume": 7737.0
  },
  {
    "Unnamed: 0.1": 1334,
    "Unnamed: 0": 1718,
    "time": 1684883400,
    "open": 184.97,
    "high": 184.97,
    "low": 184.8,
    "close": 184.91,
    "volume": 13151.0
  },
  {
    "Unnamed: 0.1": 1335,
    "Unnamed: 0": 1719,
    "time": 1684883700,
    "open": 184.92,
    "high": 184.99,
    "low": 184.9,
    "close": 184.95,
    "volume": 10107.0
  },
  {
    "Unnamed: 0.1": 1336,
    "Unnamed: 0": 1720,
    "time": 1684884000,
    "open": 184.98,
    "high": 184.98,
    "low": 184.95,
    "close": 184.95,
    "volume": 7020.0
  },
  {
    "Unnamed: 0.1": 1337,
    "Unnamed: 0": 1721,
    "time": 1684884300,
    "open": 184.95,
    "high": 185.0,
    "low": 184.93,
    "close": 184.94,
    "volume": 7698.0
  },
  {
    "Unnamed: 0.1": 1338,
    "Unnamed: 0": 1722,
    "time": 1684884600,
    "open": 184.95,
    "high": 184.95,
    "low": 184.9,
    "close": 184.91,
    "volume": 12289.0
  },
  {
    "Unnamed: 0.1": 1339,
    "Unnamed: 0": 1723,
    "time": 1684884900,
    "open": 184.91,
    "high": 185.0,
    "low": 184.91,
    "close": 184.98,
    "volume": 15144.0
  },
  {
    "Unnamed: 0.1": 1340,
    "Unnamed: 0": 1724,
    "time": 1684885200,
    "open": 184.97,
    "high": 185.0,
    "low": 184.96,
    "close": 184.97,
    "volume": 8702.0
  },
  {
    "Unnamed: 0.1": 1341,
    "Unnamed: 0": 1725,
    "time": 1684885500,
    "open": 185.0,
    "high": 185.0,
    "low": 184.95,
    "close": 184.96,
    "volume": 34794.0
  },
  {
    "Unnamed: 0.1": 1342,
    "Unnamed: 0": 1726,
    "time": 1684885800,
    "open": 184.94,
    "high": 184.95,
    "low": 184.82,
    "close": 184.82,
    "volume": 22556.0
  },
  {
    "Unnamed: 0.1": 1343,
    "Unnamed: 0": 1727,
    "time": 1684886100,
    "open": 184.82,
    "high": 184.88,
    "low": 184.82,
    "close": 184.84,
    "volume": 35029.0
  },
  {
    "Unnamed: 0.1": 1344,
    "Unnamed: 0": 1728,
    "time": 1684915200,
    "open": 184.43,
    "high": 184.69,
    "low": 184.04,
    "close": 184.25,
    "volume": 13551.0
  },
  {
    "Unnamed: 0.1": 1345,
    "Unnamed: 0": 1729,
    "time": 1684915500,
    "open": 184.35,
    "high": 184.4,
    "low": 184.05,
    "close": 184.07,
    "volume": 11095.0
  },
  {
    "Unnamed: 0.1": 1346,
    "Unnamed: 0": 1730,
    "time": 1684915800,
    "open": 184.08,
    "high": 184.1,
    "low": 183.1,
    "close": 183.1,
    "volume": 25690.0
  },
  {
    "Unnamed: 0.1": 1347,
    "Unnamed: 0": 1731,
    "time": 1684916100,
    "open": 183.14,
    "high": 183.45,
    "low": 182.86,
    "close": 183.17,
    "volume": 17514.0
  },
  {
    "Unnamed: 0.1": 1348,
    "Unnamed: 0": 1732,
    "time": 1684916400,
    "open": 183.19,
    "high": 183.48,
    "low": 183.15,
    "close": 183.44,
    "volume": 7732.0
  },
  {
    "Unnamed: 0.1": 1349,
    "Unnamed: 0": 1733,
    "time": 1684916700,
    "open": 183.45,
    "high": 183.49,
    "low": 183.39,
    "close": 183.48,
    "volume": 5405.0
  },
  {
    "Unnamed: 0.1": 1350,
    "Unnamed: 0": 1734,
    "time": 1684917000,
    "open": 183.62,
    "high": 183.62,
    "low": 183.4,
    "close": 183.42,
    "volume": 7373.0
  },
  {
    "Unnamed: 0.1": 1351,
    "Unnamed: 0": 1735,
    "time": 1684917300,
    "open": 183.42,
    "high": 183.62,
    "low": 183.42,
    "close": 183.62,
    "volume": 7639.0
  },
  {
    "Unnamed: 0.1": 1352,
    "Unnamed: 0": 1736,
    "time": 1684917600,
    "open": 183.63,
    "high": 183.83,
    "low": 183.63,
    "close": 183.79,
    "volume": 3653.0
  },
  {
    "Unnamed: 0.1": 1353,
    "Unnamed: 0": 1737,
    "time": 1684917900,
    "open": 183.85,
    "high": 183.98,
    "low": 183.53,
    "close": 183.75,
    "volume": 5846.0
  },
  {
    "Unnamed: 0.1": 1354,
    "Unnamed: 0": 1738,
    "time": 1684918200,
    "open": 183.7,
    "high": 184.01,
    "low": 183.7,
    "close": 183.99,
    "volume": 1148.0
  },
  {
    "Unnamed: 0.1": 1355,
    "Unnamed: 0": 1739,
    "time": 1684918500,
    "open": 183.93,
    "high": 184.26,
    "low": 183.93,
    "close": 184.25,
    "volume": 6490.0
  },
  {
    "Unnamed: 0.1": 1356,
    "Unnamed: 0": 1740,
    "time": 1684918800,
    "open": 184.11,
    "high": 184.44,
    "low": 184.11,
    "close": 184.3,
    "volume": 3002.0
  },
  {
    "Unnamed: 0.1": 1357,
    "Unnamed: 0": 1741,
    "time": 1684919100,
    "open": 184.31,
    "high": 184.32,
    "low": 184.0,
    "close": 184.07,
    "volume": 2541.0
  },
  {
    "Unnamed: 0.1": 1358,
    "Unnamed: 0": 1742,
    "time": 1684919400,
    "open": 184.01,
    "high": 184.1,
    "low": 183.9,
    "close": 183.9,
    "volume": 7534.0
  },
  {
    "Unnamed: 0.1": 1359,
    "Unnamed: 0": 1743,
    "time": 1684919700,
    "open": 183.97,
    "high": 183.99,
    "low": 183.43,
    "close": 183.6,
    "volume": 4135.0
  },
  {
    "Unnamed: 0.1": 1360,
    "Unnamed: 0": 1744,
    "time": 1684920000,
    "open": 183.71,
    "high": 183.88,
    "low": 183.6,
    "close": 183.88,
    "volume": 1356.0
  },
  {
    "Unnamed: 0.1": 1361,
    "Unnamed: 0": 1745,
    "time": 1684920300,
    "open": 184.0,
    "high": 184.4,
    "low": 184.0,
    "close": 184.4,
    "volume": 5597.0
  },
  {
    "Unnamed: 0.1": 1362,
    "Unnamed: 0": 1746,
    "time": 1684920600,
    "open": 184.3,
    "high": 184.3,
    "low": 184.14,
    "close": 184.21,
    "volume": 1854.0
  },
  {
    "Unnamed: 0.1": 1363,
    "Unnamed: 0": 1747,
    "time": 1684920900,
    "open": 184.28,
    "high": 184.28,
    "low": 184.17,
    "close": 184.22,
    "volume": 783.0
  },
  {
    "Unnamed: 0.1": 1364,
    "Unnamed: 0": 1748,
    "time": 1684921200,
    "open": 184.26,
    "high": 184.29,
    "low": 184.26,
    "close": 184.28,
    "volume": 1591.0
  },
  {
    "Unnamed: 0.1": 1365,
    "Unnamed: 0": 1749,
    "time": 1684921500,
    "open": 184.29,
    "high": 184.35,
    "low": 184.12,
    "close": 184.12,
    "volume": 3337.0
  },
  {
    "Unnamed: 0.1": 1366,
    "Unnamed: 0": 1750,
    "time": 1684921800,
    "open": 184.06,
    "high": 184.06,
    "low": 183.62,
    "close": 183.8,
    "volume": 7586.0
  },
  {
    "Unnamed: 0.1": 1367,
    "Unnamed: 0": 1751,
    "time": 1684922100,
    "open": 183.78,
    "high": 184.0,
    "low": 183.73,
    "close": 183.9,
    "volume": 1918.0
  },
  {
    "Unnamed: 0.1": 1368,
    "Unnamed: 0": 1752,
    "time": 1684922400,
    "open": 183.89,
    "high": 184.04,
    "low": 183.81,
    "close": 183.81,
    "volume": 2218.0
  },
  {
    "Unnamed: 0.1": 1369,
    "Unnamed: 0": 1753,
    "time": 1684922700,
    "open": 183.81,
    "high": 183.87,
    "low": 183.52,
    "close": 183.63,
    "volume": 4354.0
  },
  {
    "Unnamed: 0.1": 1370,
    "Unnamed: 0": 1754,
    "time": 1684923000,
    "open": 183.5,
    "high": 183.67,
    "low": 183.3,
    "close": 183.32,
    "volume": 8080.0
  },
  {
    "Unnamed: 0.1": 1371,
    "Unnamed: 0": 1755,
    "time": 1684923300,
    "open": 183.33,
    "high": 183.43,
    "low": 183.29,
    "close": 183.35,
    "volume": 8766.0
  },
  {
    "Unnamed: 0.1": 1372,
    "Unnamed: 0": 1756,
    "time": 1684923600,
    "open": 183.4,
    "high": 183.4,
    "low": 183.02,
    "close": 183.25,
    "volume": 5527.0
  },
  {
    "Unnamed: 0.1": 1373,
    "Unnamed: 0": 1757,
    "time": 1684923900,
    "open": 183.22,
    "high": 183.22,
    "low": 183.09,
    "close": 183.18,
    "volume": 8922.0
  },
  {
    "Unnamed: 0.1": 1374,
    "Unnamed: 0": 1758,
    "time": 1684924200,
    "open": 183.24,
    "high": 183.3,
    "low": 183.19,
    "close": 183.3,
    "volume": 2401.0
  },
  {
    "Unnamed: 0.1": 1375,
    "Unnamed: 0": 1759,
    "time": 1684924500,
    "open": 183.31,
    "high": 183.48,
    "low": 183.25,
    "close": 183.43,
    "volume": 8461.0
  },
  {
    "Unnamed: 0.1": 1376,
    "Unnamed: 0": 1760,
    "time": 1684924800,
    "open": 183.45,
    "high": 183.58,
    "low": 183.4,
    "close": 183.58,
    "volume": 3944.0
  },
  {
    "Unnamed: 0.1": 1377,
    "Unnamed: 0": 1761,
    "time": 1684925100,
    "open": 183.5,
    "high": 183.55,
    "low": 183.2,
    "close": 183.2,
    "volume": 11485.0
  },
  {
    "Unnamed: 0.1": 1378,
    "Unnamed: 0": 1762,
    "time": 1684925400,
    "open": 183.25,
    "high": 183.3,
    "low": 183.24,
    "close": 183.27,
    "volume": 1740.0
  },
  {
    "Unnamed: 0.1": 1379,
    "Unnamed: 0": 1763,
    "time": 1684925700,
    "open": 183.27,
    "high": 183.35,
    "low": 183.25,
    "close": 183.35,
    "volume": 7792.0
  },
  {
    "Unnamed: 0.1": 1380,
    "Unnamed: 0": 1764,
    "time": 1684926000,
    "open": 183.35,
    "high": 183.8,
    "low": 183.0,
    "close": 183.26,
    "volume": 51146.0
  },
  {
    "Unnamed: 0.1": 1381,
    "Unnamed: 0": 1765,
    "time": 1684926300,
    "open": 183.15,
    "high": 183.15,
    "low": 182.6,
    "close": 182.61,
    "volume": 45820.0
  },
  {
    "Unnamed: 0.1": 1382,
    "Unnamed: 0": 1766,
    "time": 1684926600,
    "open": 182.6,
    "high": 182.81,
    "low": 182.4,
    "close": 182.65,
    "volume": 32804.0
  },
  {
    "Unnamed: 0.1": 1383,
    "Unnamed: 0": 1767,
    "time": 1684926900,
    "open": 182.59,
    "high": 182.98,
    "low": 182.55,
    "close": 182.93,
    "volume": 18214.0
  },
  {
    "Unnamed: 0.1": 1384,
    "Unnamed: 0": 1768,
    "time": 1684927200,
    "open": 182.91,
    "high": 182.91,
    "low": 182.6,
    "close": 182.69,
    "volume": 9875.0
  },
  {
    "Unnamed: 0.1": 1385,
    "Unnamed: 0": 1769,
    "time": 1684927500,
    "open": 182.7,
    "high": 183.25,
    "low": 182.7,
    "close": 183.1,
    "volume": 27057.0
  },
  {
    "Unnamed: 0.1": 1386,
    "Unnamed: 0": 1770,
    "time": 1684927800,
    "open": 183.08,
    "high": 183.11,
    "low": 183.0,
    "close": 183.08,
    "volume": 11179.0
  },
  {
    "Unnamed: 0.1": 1387,
    "Unnamed: 0": 1771,
    "time": 1684928100,
    "open": 183.06,
    "high": 183.11,
    "low": 182.85,
    "close": 182.95,
    "volume": 16584.0
  },
  {
    "Unnamed: 0.1": 1388,
    "Unnamed: 0": 1772,
    "time": 1684928400,
    "open": 182.97,
    "high": 183.3,
    "low": 182.9,
    "close": 183.2,
    "volume": 24977.0
  },
  {
    "Unnamed: 0.1": 1389,
    "Unnamed: 0": 1773,
    "time": 1684928700,
    "open": 183.17,
    "high": 183.25,
    "low": 183.05,
    "close": 183.07,
    "volume": 5016.0
  },
  {
    "Unnamed: 0.1": 1390,
    "Unnamed: 0": 1774,
    "time": 1684929000,
    "open": 183.14,
    "high": 183.15,
    "low": 182.76,
    "close": 182.87,
    "volume": 13711.0
  },
  {
    "Unnamed: 0.1": 1391,
    "Unnamed: 0": 1775,
    "time": 1684929300,
    "open": 182.83,
    "high": 183.1,
    "low": 182.83,
    "close": 183.08,
    "volume": 7094.0
  },
  {
    "Unnamed: 0.1": 1392,
    "Unnamed: 0": 1776,
    "time": 1684929600,
    "open": 183.48,
    "high": 185.33,
    "low": 182.39,
    "close": 183.13,
    "volume": 205138.0
  },
  {
    "Unnamed: 0.1": 1393,
    "Unnamed: 0": 1777,
    "time": 1684929900,
    "open": 183.06,
    "high": 183.15,
    "low": 183.0,
    "close": 183.08,
    "volume": 23378.0
  },
  {
    "Unnamed: 0.1": 1394,
    "Unnamed: 0": 1778,
    "time": 1684930200,
    "open": 183.08,
    "high": 183.6,
    "low": 183.08,
    "close": 183.44,
    "volume": 76283.0
  },
  {
    "Unnamed: 0.1": 1395,
    "Unnamed: 0": 1779,
    "time": 1684930500,
    "open": 183.47,
    "high": 183.55,
    "low": 183.34,
    "close": 183.4,
    "volume": 34668.0
  },
  {
    "Unnamed: 0.1": 1396,
    "Unnamed: 0": 1780,
    "time": 1684930800,
    "open": 183.41,
    "high": 183.49,
    "low": 183.3,
    "close": 183.42,
    "volume": 22915.0
  },
  {
    "Unnamed: 0.1": 1397,
    "Unnamed: 0": 1781,
    "time": 1684931100,
    "open": 183.41,
    "high": 183.41,
    "low": 183.11,
    "close": 183.11,
    "volume": 29262.0
  },
  {
    "Unnamed: 0.1": 1398,
    "Unnamed: 0": 1782,
    "time": 1684931400,
    "open": 183.13,
    "high": 183.15,
    "low": 182.7,
    "close": 182.83,
    "volume": 56621.0
  },
  {
    "Unnamed: 0.1": 1399,
    "Unnamed: 0": 1783,
    "time": 1684931700,
    "open": 182.77,
    "high": 182.93,
    "low": 182.47,
    "close": 182.56,
    "volume": 58692.0
  },
  {
    "Unnamed: 0.1": 1400,
    "Unnamed: 0": 1784,
    "time": 1684932000,
    "open": 182.55,
    "high": 182.77,
    "low": 182.45,
    "close": 182.75,
    "volume": 41804.0
  },
  {
    "Unnamed: 0.1": 1401,
    "Unnamed: 0": 1785,
    "time": 1684932300,
    "open": 182.65,
    "high": 182.74,
    "low": 182.5,
    "close": 182.74,
    "volume": 46483.0
  },
  {
    "Unnamed: 0.1": 1402,
    "Unnamed: 0": 1786,
    "time": 1684932600,
    "open": 182.61,
    "high": 182.86,
    "low": 182.61,
    "close": 182.86,
    "volume": 43520.0
  },
  {
    "Unnamed: 0.1": 1403,
    "Unnamed: 0": 1787,
    "time": 1684932900,
    "open": 182.79,
    "high": 182.87,
    "low": 182.7,
    "close": 182.7,
    "volume": 34306.0
  },
  {
    "Unnamed: 0.1": 1404,
    "Unnamed: 0": 1788,
    "time": 1684933200,
    "open": 182.68,
    "high": 182.68,
    "low": 182.41,
    "close": 182.5,
    "volume": 55127.0
  },
  {
    "Unnamed: 0.1": 1405,
    "Unnamed: 0": 1789,
    "time": 1684933500,
    "open": 182.5,
    "high": 182.5,
    "low": 182.4,
    "close": 182.5,
    "volume": 26989.0
  },
  {
    "Unnamed: 0.1": 1406,
    "Unnamed: 0": 1790,
    "time": 1684933800,
    "open": 182.5,
    "high": 182.73,
    "low": 182.38,
    "close": 182.38,
    "volume": 51559.0
  },
  {
    "Unnamed: 0.1": 1407,
    "Unnamed: 0": 1791,
    "time": 1684934100,
    "open": 182.44,
    "high": 182.56,
    "low": 182.2,
    "close": 182.2,
    "volume": 79233.0
  },
  {
    "Unnamed: 0.1": 1408,
    "Unnamed: 0": 1792,
    "time": 1684934400,
    "open": 182.22,
    "high": 182.4,
    "low": 182.04,
    "close": 182.2,
    "volume": 75077.0
  },
  {
    "Unnamed: 0.1": 1409,
    "Unnamed: 0": 1793,
    "time": 1684934700,
    "open": 182.16,
    "high": 182.3,
    "low": 181.91,
    "close": 182.25,
    "volume": 102134.0
  },
  {
    "Unnamed: 0.1": 1410,
    "Unnamed: 0": 1794,
    "time": 1684935000,
    "open": 182.23,
    "high": 182.8,
    "low": 181.26,
    "close": 182.79,
    "volume": 4459857.0
  },
  {
    "Unnamed: 0.1": 1411,
    "Unnamed: 0": 1795,
    "time": 1684935300,
    "open": 182.77,
    "high": 182.94,
    "low": 181.4,
    "close": 181.64,
    "volume": 2735937.0
  },
  {
    "Unnamed: 0.1": 1412,
    "Unnamed: 0": 1796,
    "time": 1684935600,
    "open": 181.66,
    "high": 182.44,
    "low": 181.32,
    "close": 181.71,
    "volume": 2611681.0
  },
  {
    "Unnamed: 0.1": 1413,
    "Unnamed: 0": 1797,
    "time": 1684935900,
    "open": 181.72,
    "high": 182.64,
    "low": 180.7,
    "close": 180.89,
    "volume": 3307947.0
  },
  {
    "Unnamed: 0.1": 1414,
    "Unnamed: 0": 1798,
    "time": 1684936200,
    "open": 180.9,
    "high": 180.98,
    "low": 179.36,
    "close": 179.46,
    "volume": 3591803.0
  },
  {
    "Unnamed: 0.1": 1415,
    "Unnamed: 0": 1799,
    "time": 1684936500,
    "open": 179.44,
    "high": 180.42,
    "low": 179.26,
    "close": 179.95,
    "volume": 2781973.0
  },
  {
    "Unnamed: 0.1": 1416,
    "Unnamed: 0": 1800,
    "time": 1684936800,
    "open": 179.94,
    "high": 180.29,
    "low": 179.82,
    "close": 179.94,
    "volume": 717301.0
  },
  {
    "Unnamed: 0.1": 1417,
    "Unnamed: 0": 1801,
    "time": 1685001600,
    "open": 185.98,
    "high": 186.6,
    "low": 185.15,
    "close": 185.97,
    "volume": 10166.0
  },
  {
    "Unnamed: 0.1": 1418,
    "Unnamed: 0": 1802,
    "time": 1685001900,
    "open": 186.0,
    "high": 186.01,
    "low": 185.71,
    "close": 186.01,
    "volume": 3119.0
  },
  {
    "Unnamed: 0.1": 1419,
    "Unnamed: 0": 1803,
    "time": 1685002200,
    "open": 186.1,
    "high": 186.1,
    "low": 185.8,
    "close": 185.8,
    "volume": 3679.0
  },
  {
    "Unnamed: 0.1": 1420,
    "Unnamed: 0": 1804,
    "time": 1685002500,
    "open": 185.82,
    "high": 185.94,
    "low": 185.75,
    "close": 185.85,
    "volume": 4922.0
  },
  {
    "Unnamed: 0.1": 1421,
    "Unnamed: 0": 1805,
    "time": 1685002800,
    "open": 185.76,
    "high": 185.76,
    "low": 185.3,
    "close": 185.3,
    "volume": 4424.0
  },
  {
    "Unnamed: 0.1": 1422,
    "Unnamed: 0": 1806,
    "time": 1685003100,
    "open": 185.24,
    "high": 185.42,
    "low": 185.2,
    "close": 185.4,
    "volume": 2097.0
  },
  {
    "Unnamed: 0.1": 1423,
    "Unnamed: 0": 1807,
    "time": 1685003400,
    "open": 185.4,
    "high": 185.4,
    "low": 185.25,
    "close": 185.26,
    "volume": 4506.0
  },
  {
    "Unnamed: 0.1": 1424,
    "Unnamed: 0": 1808,
    "time": 1685003700,
    "open": 185.27,
    "high": 185.7,
    "low": 185.27,
    "close": 185.59,
    "volume": 1704.0
  },
  {
    "Unnamed: 0.1": 1425,
    "Unnamed: 0": 1809,
    "time": 1685004000,
    "open": 185.7,
    "high": 185.7,
    "low": 185.55,
    "close": 185.55,
    "volume": 1306.0
  },
  {
    "Unnamed: 0.1": 1426,
    "Unnamed: 0": 1810,
    "time": 1685004300,
    "open": 185.59,
    "high": 185.7,
    "low": 185.57,
    "close": 185.65,
    "volume": 2041.0
  },
  {
    "Unnamed: 0.1": 1427,
    "Unnamed: 0": 1811,
    "time": 1685004600,
    "open": 185.67,
    "high": 185.89,
    "low": 185.67,
    "close": 185.89,
    "volume": 3298.0
  },
  {
    "Unnamed: 0.1": 1428,
    "Unnamed: 0": 1812,
    "time": 1685004900,
    "open": 185.95,
    "high": 186.0,
    "low": 185.95,
    "close": 185.97,
    "volume": 14844.0
  },
  {
    "Unnamed: 0.1": 1429,
    "Unnamed: 0": 1813,
    "time": 1685005200,
    "open": 185.97,
    "high": 185.97,
    "low": 185.93,
    "close": 185.93,
    "volume": 1635.0
  },
  {
    "Unnamed: 0.1": 1430,
    "Unnamed: 0": 1814,
    "time": 1685005500,
    "open": 185.99,
    "high": 185.99,
    "low": 185.93,
    "close": 185.93,
    "volume": 3536.0
  },
  {
    "Unnamed: 0.1": 1431,
    "Unnamed: 0": 1815,
    "time": 1685005800,
    "open": 185.92,
    "high": 185.92,
    "low": 185.7,
    "close": 185.72,
    "volume": 1789.0
  },
  {
    "Unnamed: 0.1": 1432,
    "Unnamed: 0": 1816,
    "time": 1685006100,
    "open": 185.68,
    "high": 185.95,
    "low": 185.68,
    "close": 185.95,
    "volume": 974.0
  },
  {
    "Unnamed: 0.1": 1433,
    "Unnamed: 0": 1817,
    "time": 1685006400,
    "open": 185.98,
    "high": 186.0,
    "low": 185.88,
    "close": 185.88,
    "volume": 4225.0
  },
  {
    "Unnamed: 0.1": 1434,
    "Unnamed: 0": 1818,
    "time": 1685006700,
    "open": 185.95,
    "high": 185.96,
    "low": 185.88,
    "close": 185.88,
    "volume": 2743.0
  },
  {
    "Unnamed: 0.1": 1435,
    "Unnamed: 0": 1819,
    "time": 1685007000,
    "open": 185.9,
    "high": 185.92,
    "low": 185.78,
    "close": 185.91,
    "volume": 1323.0
  },
  {
    "Unnamed: 0.1": 1436,
    "Unnamed: 0": 1820,
    "time": 1685007300,
    "open": 185.85,
    "high": 185.85,
    "low": 185.8,
    "close": 185.8,
    "volume": 300.0
  },
  {
    "Unnamed: 0.1": 1437,
    "Unnamed: 0": 1821,
    "time": 1685007600,
    "open": 185.92,
    "high": 186.28,
    "low": 185.85,
    "close": 186.12,
    "volume": 7832.0
  },
  {
    "Unnamed: 0.1": 1438,
    "Unnamed: 0": 1822,
    "time": 1685007900,
    "open": 186.16,
    "high": 186.32,
    "low": 186.16,
    "close": 186.31,
    "volume": 4253.0
  },
  {
    "Unnamed: 0.1": 1439,
    "Unnamed: 0": 1823,
    "time": 1685008200,
    "open": 186.33,
    "high": 186.4,
    "low": 186.33,
    "close": 186.4,
    "volume": 1771.0
  },
  {
    "Unnamed: 0.1": 1440,
    "Unnamed: 0": 1824,
    "time": 1685008500,
    "open": 186.46,
    "high": 186.58,
    "low": 186.42,
    "close": 186.42,
    "volume": 7448.0
  },
  {
    "Unnamed: 0.1": 1441,
    "Unnamed: 0": 1825,
    "time": 1685008800,
    "open": 186.38,
    "high": 186.38,
    "low": 186.0,
    "close": 186.27,
    "volume": 3380.0
  },
  {
    "Unnamed: 0.1": 1442,
    "Unnamed: 0": 1826,
    "time": 1685009100,
    "open": 186.3,
    "high": 186.59,
    "low": 186.22,
    "close": 186.59,
    "volume": 4492.0
  },
  {
    "Unnamed: 0.1": 1443,
    "Unnamed: 0": 1827,
    "time": 1685009400,
    "open": 186.55,
    "high": 186.59,
    "low": 186.0,
    "close": 186.22,
    "volume": 5176.0
  },
  {
    "Unnamed: 0.1": 1444,
    "Unnamed: 0": 1828,
    "time": 1685009700,
    "open": 186.2,
    "high": 186.5,
    "low": 186.2,
    "close": 186.47,
    "volume": 1393.0
  },
  {
    "Unnamed: 0.1": 1445,
    "Unnamed: 0": 1829,
    "time": 1685010000,
    "open": 186.43,
    "high": 186.43,
    "low": 186.34,
    "close": 186.34,
    "volume": 1663.0
  },
  {
    "Unnamed: 0.1": 1446,
    "Unnamed: 0": 1830,
    "time": 1685010300,
    "open": 186.38,
    "high": 186.39,
    "low": 186.33,
    "close": 186.33,
    "volume": 1001.0
  },
  {
    "Unnamed: 0.1": 1447,
    "Unnamed: 0": 1831,
    "time": 1685010600,
    "open": 186.25,
    "high": 186.35,
    "low": 186.2,
    "close": 186.2,
    "volume": 1864.0
  },
  {
    "Unnamed: 0.1": 1448,
    "Unnamed: 0": 1832,
    "time": 1685010900,
    "open": 186.4,
    "high": 186.4,
    "low": 186.37,
    "close": 186.37,
    "volume": 730.0
  },
  {
    "Unnamed: 0.1": 1449,
    "Unnamed: 0": 1833,
    "time": 1685011200,
    "open": 186.25,
    "high": 186.25,
    "low": 185.7,
    "close": 185.8,
    "volume": 5340.0
  },
  {
    "Unnamed: 0.1": 1450,
    "Unnamed: 0": 1834,
    "time": 1685011500,
    "open": 185.83,
    "high": 185.9,
    "low": 185.68,
    "close": 185.68,
    "volume": 6148.0
  },
  {
    "Unnamed: 0.1": 1451,
    "Unnamed: 0": 1835,
    "time": 1685011800,
    "open": 185.61,
    "high": 185.66,
    "low": 185.42,
    "close": 185.5,
    "volume": 3908.0
  },
  {
    "Unnamed: 0.1": 1452,
    "Unnamed: 0": 1836,
    "time": 1685012100,
    "open": 185.5,
    "high": 185.5,
    "low": 185.41,
    "close": 185.41,
    "volume": 2017.0
  },
  {
    "Unnamed: 0.1": 1453,
    "Unnamed: 0": 1837,
    "time": 1685012400,
    "open": 185.41,
    "high": 186.25,
    "low": 185.3,
    "close": 185.87,
    "volume": 25054.0
  },
  {
    "Unnamed: 0.1": 1454,
    "Unnamed: 0": 1838,
    "time": 1685012700,
    "open": 185.85,
    "high": 185.9,
    "low": 185.6,
    "close": 185.7,
    "volume": 20886.0
  },
  {
    "Unnamed: 0.1": 1455,
    "Unnamed: 0": 1839,
    "time": 1685013000,
    "open": 185.66,
    "high": 185.7,
    "low": 185.26,
    "close": 185.56,
    "volume": 18066.0
  },
  {
    "Unnamed: 0.1": 1456,
    "Unnamed: 0": 1840,
    "time": 1685013300,
    "open": 185.59,
    "high": 185.65,
    "low": 185.5,
    "close": 185.55,
    "volume": 7127.0
  },
  {
    "Unnamed: 0.1": 1457,
    "Unnamed: 0": 1841,
    "time": 1685013600,
    "open": 185.53,
    "high": 185.6,
    "low": 185.35,
    "close": 185.6,
    "volume": 8978.0
  },
  {
    "Unnamed: 0.1": 1458,
    "Unnamed: 0": 1842,
    "time": 1685013900,
    "open": 185.59,
    "high": 185.69,
    "low": 185.59,
    "close": 185.65,
    "volume": 8199.0
  },
  {
    "Unnamed: 0.1": 1459,
    "Unnamed: 0": 1843,
    "time": 1685014200,
    "open": 185.61,
    "high": 185.84,
    "low": 185.44,
    "close": 185.8,
    "volume": 12923.0
  },
  {
    "Unnamed: 0.1": 1460,
    "Unnamed: 0": 1844,
    "time": 1685014500,
    "open": 185.77,
    "high": 185.77,
    "low": 185.6,
    "close": 185.6,
    "volume": 4964.0
  },
  {
    "Unnamed: 0.1": 1461,
    "Unnamed: 0": 1845,
    "time": 1685014800,
    "open": 185.75,
    "high": 185.94,
    "low": 185.7,
    "close": 185.8,
    "volume": 15479.0
  },
  {
    "Unnamed: 0.1": 1462,
    "Unnamed: 0": 1846,
    "time": 1685015100,
    "open": 185.8,
    "high": 185.84,
    "low": 185.75,
    "close": 185.84,
    "volume": 3338.0
  },
  {
    "Unnamed: 0.1": 1463,
    "Unnamed: 0": 1847,
    "time": 1685015400,
    "open": 185.88,
    "high": 185.95,
    "low": 185.85,
    "close": 185.95,
    "volume": 13343.0
  },
  {
    "Unnamed: 0.1": 1464,
    "Unnamed: 0": 1848,
    "time": 1685015700,
    "open": 185.97,
    "high": 186.3,
    "low": 185.97,
    "close": 186.18,
    "volume": 25860.0
  },
  {
    "Unnamed: 0.1": 1465,
    "Unnamed: 0": 1849,
    "time": 1685016000,
    "open": 186.13,
    "high": 186.57,
    "low": 185.15,
    "close": 186.5,
    "volume": 231796.0
  },
  {
    "Unnamed: 0.1": 1466,
    "Unnamed: 0": 1850,
    "time": 1685016300,
    "open": 186.56,
    "high": 186.81,
    "low": 186.5,
    "close": 186.58,
    "volume": 44648.0
  },
  {
    "Unnamed: 0.1": 1467,
    "Unnamed: 0": 1851,
    "time": 1685016600,
    "open": 186.58,
    "high": 186.75,
    "low": 186.5,
    "close": 186.6,
    "volume": 45578.0
  },
  {
    "Unnamed: 0.1": 1468,
    "Unnamed: 0": 1852,
    "time": 1685016900,
    "open": 186.67,
    "high": 186.76,
    "low": 186.4,
    "close": 186.7,
    "volume": 40000.0
  },
  {
    "Unnamed: 0.1": 1469,
    "Unnamed: 0": 1853,
    "time": 1685017200,
    "open": 186.69,
    "high": 186.73,
    "low": 186.45,
    "close": 186.67,
    "volume": 34543.0
  },
  {
    "Unnamed: 0.1": 1470,
    "Unnamed: 0": 1854,
    "time": 1685017500,
    "open": 186.67,
    "high": 186.69,
    "low": 186.4,
    "close": 186.4,
    "volume": 30956.0
  },
  {
    "Unnamed: 0.1": 1471,
    "Unnamed: 0": 1855,
    "time": 1685017800,
    "open": 186.4,
    "high": 186.45,
    "low": 185.95,
    "close": 186.22,
    "volume": 60830.0
  },
  {
    "Unnamed: 0.1": 1472,
    "Unnamed: 0": 1856,
    "time": 1685018100,
    "open": 186.22,
    "high": 186.69,
    "low": 186.15,
    "close": 186.69,
    "volume": 35091.0
  },
  {
    "Unnamed: 0.1": 1473,
    "Unnamed: 0": 1857,
    "time": 1685018400,
    "open": 186.65,
    "high": 187.24,
    "low": 186.5,
    "close": 187.22,
    "volume": 76265.0
  },
  {
    "Unnamed: 0.1": 1474,
    "Unnamed: 0": 1858,
    "time": 1685018700,
    "open": 187.24,
    "high": 187.25,
    "low": 186.91,
    "close": 186.95,
    "volume": 74132.0
  },
  {
    "Unnamed: 0.1": 1475,
    "Unnamed: 0": 1859,
    "time": 1685019000,
    "open": 186.91,
    "high": 187.1,
    "low": 186.77,
    "close": 186.98,
    "volume": 61890.0
  },
  {
    "Unnamed: 0.1": 1476,
    "Unnamed: 0": 1860,
    "time": 1685019300,
    "open": 186.99,
    "high": 187.11,
    "low": 186.95,
    "close": 187.04,
    "volume": 32758.0
  },
  {
    "Unnamed: 0.1": 1477,
    "Unnamed: 0": 1861,
    "time": 1685019600,
    "open": 187.04,
    "high": 187.07,
    "low": 186.45,
    "close": 186.5,
    "volume": 62351.0
  },
  {
    "Unnamed: 0.1": 1478,
    "Unnamed: 0": 1862,
    "time": 1685019900,
    "open": 186.44,
    "high": 186.85,
    "low": 186.38,
    "close": 186.85,
    "volume": 40454.0
  },
  {
    "Unnamed: 0.1": 1479,
    "Unnamed: 0": 1863,
    "time": 1685020200,
    "open": 186.8,
    "high": 186.85,
    "low": 186.73,
    "close": 186.8,
    "volume": 26228.0
  },
  {
    "Unnamed: 0.1": 1480,
    "Unnamed: 0": 1864,
    "time": 1685020500,
    "open": 186.75,
    "high": 186.79,
    "low": 186.47,
    "close": 186.55,
    "volume": 33391.0
  },
  {
    "Unnamed: 0.1": 1481,
    "Unnamed: 0": 1865,
    "time": 1685020800,
    "open": 186.54,
    "high": 186.7,
    "low": 186.33,
    "close": 186.33,
    "volume": 33653.0
  },
  {
    "Unnamed: 0.1": 1482,
    "Unnamed: 0": 1866,
    "time": 1685021100,
    "open": 186.3,
    "high": 186.68,
    "low": 186.22,
    "close": 186.51,
    "volume": 35309.0
  },
  {
    "Unnamed: 0.1": 1483,
    "Unnamed: 0": 1867,
    "time": 1685021400,
    "open": 186.48,
    "high": 186.78,
    "low": 184.58,
    "close": 185.16,
    "volume": 2829571.0
  },
  {
    "Unnamed: 0.1": 1484,
    "Unnamed: 0": 1868,
    "time": 1685021700,
    "open": 185.18,
    "high": 185.78,
    "low": 184.85,
    "close": 185.21,
    "volume": 1852954.0
  },
  {
    "Unnamed: 0.1": 1485,
    "Unnamed: 0": 1869,
    "time": 1685022000,
    "open": 185.18,
    "high": 185.48,
    "low": 183.7,
    "close": 183.76,
    "volume": 2203840.0
  },
  {
    "Unnamed: 0.1": 1486,
    "Unnamed: 0": 1870,
    "time": 1685022300,
    "open": 183.8,
    "high": 184.07,
    "low": 182.72,
    "close": 183.02,
    "volume": 2282488.0
  },
  {
    "Unnamed: 0.1": 1487,
    "Unnamed: 0": 1871,
    "time": 1685022600,
    "open": 183.03,
    "high": 183.97,
    "low": 182.59,
    "close": 183.92,
    "volume": 2003000.0
  },
  {
    "Unnamed: 0.1": 1488,
    "Unnamed: 0": 1872,
    "time": 1685022900,
    "open": 183.94,
    "high": 184.02,
    "low": 183.09,
    "close": 183.51,
    "volume": 1315487.0
  },
  {
    "Unnamed: 0.1": 1489,
    "Unnamed: 0": 1873,
    "time": 1685023200,
    "open": 183.52,
    "high": 184.14,
    "low": 182.8,
    "close": 182.87,
    "volume": 1469194.0
  },
  {
    "Unnamed: 0.1": 1490,
    "Unnamed: 0": 1874,
    "time": 1685023500,
    "open": 182.88,
    "high": 183.09,
    "low": 181.87,
    "close": 182.21,
    "volume": 1698064.0
  },
  {
    "Unnamed: 0.1": 1491,
    "Unnamed: 0": 1875,
    "time": 1685023800,
    "open": 182.2,
    "high": 182.24,
    "low": 180.91,
    "close": 181.12,
    "volume": 1641962.0
  },
  {
    "Unnamed: 0.1": 1492,
    "Unnamed: 0": 1876,
    "time": 1685024100,
    "open": 181.11,
    "high": 181.74,
    "low": 180.58,
    "close": 181.41,
    "volume": 1490956.0
  },
  {
    "Unnamed: 0.1": 1493,
    "Unnamed: 0": 1877,
    "time": 1685024400,
    "open": 181.4,
    "high": 181.8,
    "low": 181.12,
    "close": 181.28,
    "volume": 1178941.0
  },
  {
    "Unnamed: 0.1": 1494,
    "Unnamed: 0": 1878,
    "time": 1685024700,
    "open": 181.26,
    "high": 182.68,
    "low": 181.2,
    "close": 182.52,
    "volume": 1488942.0
  },
  {
    "Unnamed: 0.1": 1495,
    "Unnamed: 0": 1879,
    "time": 1685025000,
    "open": 182.55,
    "high": 183.03,
    "low": 182.18,
    "close": 182.99,
    "volume": 1338863.0
  },
  {
    "Unnamed: 0.1": 1496,
    "Unnamed: 0": 1880,
    "time": 1685025300,
    "open": 182.98,
    "high": 183.8,
    "low": 182.96,
    "close": 183.77,
    "volume": 1511944.0
  },
  {
    "Unnamed: 0.1": 1497,
    "Unnamed: 0": 1881,
    "time": 1685025600,
    "open": 183.77,
    "high": 184.22,
    "low": 183.64,
    "close": 183.97,
    "volume": 1418518.0
  },
  {
    "Unnamed: 0.1": 1498,
    "Unnamed: 0": 1882,
    "time": 1685025900,
    "open": 183.96,
    "high": 184.61,
    "low": 183.92,
    "close": 184.17,
    "volume": 1739624.0
  },
  {
    "Unnamed: 0.1": 1499,
    "Unnamed: 0": 1883,
    "time": 1685026200,
    "open": 184.16,
    "high": 184.39,
    "low": 183.71,
    "close": 183.96,
    "volume": 1019396.0
  },
  {
    "Unnamed: 0.1": 1500,
    "Unnamed: 0": 1884,
    "time": 1685026500,
    "open": 183.94,
    "high": 184.39,
    "low": 183.79,
    "close": 184.27,
    "volume": 951349.0
  },
  {
    "Unnamed: 0.1": 1501,
    "Unnamed: 0": 1885,
    "time": 1685026800,
    "open": 184.27,
    "high": 184.51,
    "low": 183.93,
    "close": 184.4,
    "volume": 1123378.0
  },
  {
    "Unnamed: 0.1": 1502,
    "Unnamed: 0": 1886,
    "time": 1685027100,
    "open": 184.45,
    "high": 184.78,
    "low": 183.94,
    "close": 184.14,
    "volume": 1292167.0
  },
  {
    "Unnamed: 0.1": 1503,
    "Unnamed: 0": 1887,
    "time": 1685027400,
    "open": 184.15,
    "high": 184.95,
    "low": 184.07,
    "close": 184.61,
    "volume": 1229650.0
  },
  {
    "Unnamed: 0.1": 1504,
    "Unnamed: 0": 1888,
    "time": 1685027700,
    "open": 184.62,
    "high": 184.95,
    "low": 184.15,
    "close": 184.69,
    "volume": 1229222.0
  },
  {
    "Unnamed: 0.1": 1505,
    "Unnamed: 0": 1889,
    "time": 1685028000,
    "open": 184.66,
    "high": 185.04,
    "low": 184.46,
    "close": 184.6,
    "volume": 1137236.0
  },
  {
    "Unnamed: 0.1": 1506,
    "Unnamed: 0": 1890,
    "time": 1685028300,
    "open": 184.6,
    "high": 184.98,
    "low": 184.31,
    "close": 184.4,
    "volume": 984208.0
  },
  {
    "Unnamed: 0.1": 1507,
    "Unnamed: 0": 1891,
    "time": 1685028600,
    "open": 184.41,
    "high": 184.43,
    "low": 183.49,
    "close": 183.54,
    "volume": 1055219.0
  },
  {
    "Unnamed: 0.1": 1508,
    "Unnamed: 0": 1892,
    "time": 1685028900,
    "open": 183.53,
    "high": 184.23,
    "low": 183.44,
    "close": 184.04,
    "volume": 1111427.0
  },
  {
    "Unnamed: 0.1": 1509,
    "Unnamed: 0": 1893,
    "time": 1685029200,
    "open": 184.04,
    "high": 184.06,
    "low": 183.56,
    "close": 183.82,
    "volume": 714874.0
  },
  {
    "Unnamed: 0.1": 1510,
    "Unnamed: 0": 1894,
    "time": 1685029500,
    "open": 183.82,
    "high": 184.2,
    "low": 183.66,
    "close": 183.87,
    "volume": 768589.0
  },
  {
    "Unnamed: 0.1": 1511,
    "Unnamed: 0": 1895,
    "time": 1685029800,
    "open": 183.88,
    "high": 184.55,
    "low": 183.74,
    "close": 184.38,
    "volume": 881841.0
  },
  {
    "Unnamed: 0.1": 1512,
    "Unnamed: 0": 1896,
    "time": 1685030100,
    "open": 184.35,
    "high": 184.63,
    "low": 184.02,
    "close": 184.5,
    "volume": 801053.0
  },
  {
    "Unnamed: 0.1": 1513,
    "Unnamed: 0": 1897,
    "time": 1685030400,
    "open": 184.52,
    "high": 184.88,
    "low": 184.46,
    "close": 184.77,
    "volume": 794304.0
  },
  {
    "Unnamed: 0.1": 1514,
    "Unnamed: 0": 1898,
    "time": 1685030700,
    "open": 184.79,
    "high": 184.83,
    "low": 184.33,
    "close": 184.34,
    "volume": 665435.0
  },
  {
    "Unnamed: 0.1": 1515,
    "Unnamed: 0": 1899,
    "time": 1685031000,
    "open": 184.36,
    "high": 184.61,
    "low": 184.22,
    "close": 184.42,
    "volume": 597881.0
  },
  {
    "Unnamed: 0.1": 1516,
    "Unnamed: 0": 1900,
    "time": 1685031300,
    "open": 184.43,
    "high": 184.53,
    "low": 183.95,
    "close": 184.06,
    "volume": 649929.0
  },
  {
    "Unnamed: 0.1": 1517,
    "Unnamed: 0": 1901,
    "time": 1685031600,
    "open": 184.07,
    "high": 184.99,
    "low": 183.91,
    "close": 184.91,
    "volume": 1107287.0
  },
  {
    "Unnamed: 0.1": 1518,
    "Unnamed: 0": 1902,
    "time": 1685031900,
    "open": 184.9,
    "high": 185.31,
    "low": 184.89,
    "close": 185.26,
    "volume": 1003887.0
  },
  {
    "Unnamed: 0.1": 1519,
    "Unnamed: 0": 1903,
    "time": 1685032200,
    "open": 185.27,
    "high": 185.42,
    "low": 184.82,
    "close": 184.98,
    "volume": 864849.0
  },
  {
    "Unnamed: 0.1": 1520,
    "Unnamed: 0": 1904,
    "time": 1685032500,
    "open": 185.0,
    "high": 185.35,
    "low": 184.97,
    "close": 185.32,
    "volume": 568670.0
  },
  {
    "Unnamed: 0.1": 1521,
    "Unnamed: 0": 1905,
    "time": 1685032800,
    "open": 185.33,
    "high": 185.53,
    "low": 185.2,
    "close": 185.47,
    "volume": 741136.0
  },
  {
    "Unnamed: 0.1": 1522,
    "Unnamed: 0": 1906,
    "time": 1685033100,
    "open": 185.48,
    "high": 185.61,
    "low": 185.26,
    "close": 185.38,
    "volume": 619779.0
  },
  {
    "Unnamed: 0.1": 1523,
    "Unnamed: 0": 1907,
    "time": 1685033400,
    "open": 185.38,
    "high": 185.45,
    "low": 185.03,
    "close": 185.03,
    "volume": 563197.0
  },
  {
    "Unnamed: 0.1": 1524,
    "Unnamed: 0": 1908,
    "time": 1685033700,
    "open": 185.02,
    "high": 185.32,
    "low": 184.37,
    "close": 184.42,
    "volume": 850767.0
  },
  {
    "Unnamed: 0.1": 1525,
    "Unnamed: 0": 1909,
    "time": 1685034000,
    "open": 184.41,
    "high": 184.58,
    "low": 184.14,
    "close": 184.43,
    "volume": 724485.0
  },
  {
    "Unnamed: 0.1": 1526,
    "Unnamed: 0": 1910,
    "time": 1685034300,
    "open": 184.45,
    "high": 184.54,
    "low": 184.11,
    "close": 184.25,
    "volume": 577698.0
  },
  {
    "Unnamed: 0.1": 1527,
    "Unnamed: 0": 1911,
    "time": 1685034600,
    "open": 184.24,
    "high": 184.51,
    "low": 184.03,
    "close": 184.05,
    "volume": 694323.0
  },
  {
    "Unnamed: 0.1": 1528,
    "Unnamed: 0": 1912,
    "time": 1685034900,
    "open": 184.03,
    "high": 184.34,
    "low": 183.95,
    "close": 184.22,
    "volume": 584609.0
  },
  {
    "Unnamed: 0.1": 1529,
    "Unnamed: 0": 1913,
    "time": 1685035200,
    "open": 184.22,
    "high": 184.47,
    "low": 184.21,
    "close": 184.38,
    "volume": 526218.0
  },
  {
    "Unnamed: 0.1": 1530,
    "Unnamed: 0": 1914,
    "time": 1685035500,
    "open": 184.38,
    "high": 184.44,
    "low": 184.13,
    "close": 184.29,
    "volume": 596305.0
  },
  {
    "Unnamed: 0.1": 1531,
    "Unnamed: 0": 1915,
    "time": 1685035800,
    "open": 184.29,
    "high": 184.51,
    "low": 184.07,
    "close": 184.51,
    "volume": 603923.0
  },
  {
    "Unnamed: 0.1": 1532,
    "Unnamed: 0": 1916,
    "time": 1685036100,
    "open": 184.53,
    "high": 184.74,
    "low": 184.46,
    "close": 184.59,
    "volume": 575720.0
  },
  {
    "Unnamed: 0.1": 1533,
    "Unnamed: 0": 1917,
    "time": 1685036400,
    "open": 184.59,
    "high": 184.65,
    "low": 184.29,
    "close": 184.55,
    "volume": 524317.0
  },
  {
    "Unnamed: 0.1": 1534,
    "Unnamed: 0": 1918,
    "time": 1685036700,
    "open": 184.55,
    "high": 184.84,
    "low": 184.53,
    "close": 184.8,
    "volume": 576451.0
  },
  {
    "Unnamed: 0.1": 1535,
    "Unnamed: 0": 1919,
    "time": 1685037000,
    "open": 184.77,
    "high": 184.88,
    "low": 184.63,
    "close": 184.8,
    "volume": 458732.0
  },
  {
    "Unnamed: 0.1": 1536,
    "Unnamed: 0": 1920,
    "time": 1685037300,
    "open": 184.79,
    "high": 185.1,
    "low": 184.71,
    "close": 184.97,
    "volume": 586909.0
  },
  {
    "Unnamed: 0.1": 1537,
    "Unnamed: 0": 1921,
    "time": 1685037600,
    "open": 184.97,
    "high": 185.64,
    "low": 184.97,
    "close": 185.31,
    "volume": 1063038.0
  },
  {
    "Unnamed: 0.1": 1538,
    "Unnamed: 0": 1922,
    "time": 1685037900,
    "open": 185.3,
    "high": 185.6,
    "low": 184.92,
    "close": 185.35,
    "volume": 932519.0
  },
  {
    "Unnamed: 0.1": 1539,
    "Unnamed: 0": 1923,
    "time": 1685038200,
    "open": 185.37,
    "high": 185.58,
    "low": 185.22,
    "close": 185.54,
    "volume": 532351.0
  },
  {
    "Unnamed: 0.1": 1540,
    "Unnamed: 0": 1924,
    "time": 1685038500,
    "open": 185.53,
    "high": 185.72,
    "low": 185.41,
    "close": 185.61,
    "volume": 781586.0
  },
  {
    "Unnamed: 0.1": 1541,
    "Unnamed: 0": 1925,
    "time": 1685038800,
    "open": 185.61,
    "high": 185.77,
    "low": 185.11,
    "close": 185.21,
    "volume": 868407.0
  },
  {
    "Unnamed: 0.1": 1542,
    "Unnamed: 0": 1926,
    "time": 1685039100,
    "open": 185.2,
    "high": 185.22,
    "low": 184.71,
    "close": 184.71,
    "volume": 704298.0
  },
  {
    "Unnamed: 0.1": 1543,
    "Unnamed: 0": 1927,
    "time": 1685039400,
    "open": 184.74,
    "high": 184.78,
    "low": 184.12,
    "close": 184.4,
    "volume": 900506.0
  },
  {
    "Unnamed: 0.1": 1544,
    "Unnamed: 0": 1928,
    "time": 1685039700,
    "open": 184.41,
    "high": 184.45,
    "low": 184.16,
    "close": 184.24,
    "volume": 549467.0
  },
  {
    "Unnamed: 0.1": 1545,
    "Unnamed: 0": 1929,
    "time": 1685040000,
    "open": 184.22,
    "high": 184.39,
    "low": 183.83,
    "close": 183.85,
    "volume": 714203.0
  },
  {
    "Unnamed: 0.1": 1546,
    "Unnamed: 0": 1930,
    "time": 1685040300,
    "open": 183.84,
    "high": 183.93,
    "low": 183.54,
    "close": 183.74,
    "volume": 770287.0
  },
  {
    "Unnamed: 0.1": 1547,
    "Unnamed: 0": 1931,
    "time": 1685040600,
    "open": 183.74,
    "high": 183.89,
    "low": 183.51,
    "close": 183.64,
    "volume": 517086.0
  },
  {
    "Unnamed: 0.1": 1548,
    "Unnamed: 0": 1932,
    "time": 1685040900,
    "open": 183.64,
    "high": 183.72,
    "low": 182.75,
    "close": 182.87,
    "volume": 1260390.0
  },
  {
    "Unnamed: 0.1": 1549,
    "Unnamed: 0": 1933,
    "time": 1685041200,
    "open": 182.87,
    "high": 183.23,
    "low": 182.77,
    "close": 183.21,
    "volume": 968338.0
  },
  {
    "Unnamed: 0.1": 1550,
    "Unnamed: 0": 1934,
    "time": 1685041500,
    "open": 183.19,
    "high": 183.87,
    "low": 183.18,
    "close": 183.84,
    "volume": 984833.0
  },
  {
    "Unnamed: 0.1": 1551,
    "Unnamed: 0": 1935,
    "time": 1685041800,
    "open": 183.83,
    "high": 184.1,
    "low": 183.78,
    "close": 183.92,
    "volume": 847092.0
  },
  {
    "Unnamed: 0.1": 1552,
    "Unnamed: 0": 1936,
    "time": 1685042100,
    "open": 183.92,
    "high": 184.04,
    "low": 183.62,
    "close": 184.02,
    "volume": 601777.0
  },
  {
    "Unnamed: 0.1": 1553,
    "Unnamed: 0": 1937,
    "time": 1685042400,
    "open": 184.01,
    "high": 184.43,
    "low": 183.97,
    "close": 184.21,
    "volume": 785687.0
  },
  {
    "Unnamed: 0.1": 1554,
    "Unnamed: 0": 1938,
    "time": 1685042700,
    "open": 184.23,
    "high": 184.62,
    "low": 183.99,
    "close": 184.49,
    "volume": 861470.0
  },
  {
    "Unnamed: 0.1": 1555,
    "Unnamed: 0": 1939,
    "time": 1685043000,
    "open": 184.5,
    "high": 184.68,
    "low": 184.17,
    "close": 184.36,
    "volume": 724312.0
  },
  {
    "Unnamed: 0.1": 1556,
    "Unnamed: 0": 1940,
    "time": 1685043300,
    "open": 184.34,
    "high": 184.7,
    "low": 184.25,
    "close": 184.59,
    "volume": 714282.0
  },
  {
    "Unnamed: 0.1": 1557,
    "Unnamed: 0": 1941,
    "time": 1685043600,
    "open": 184.6,
    "high": 184.86,
    "low": 184.38,
    "close": 184.79,
    "volume": 754149.0
  },
  {
    "Unnamed: 0.1": 1558,
    "Unnamed: 0": 1942,
    "time": 1685043900,
    "open": 184.77,
    "high": 184.89,
    "low": 184.37,
    "close": 184.41,
    "volume": 780752.0
  },
  {
    "Unnamed: 0.1": 1559,
    "Unnamed: 0": 1943,
    "time": 1685044200,
    "open": 184.42,
    "high": 184.72,
    "low": 184.34,
    "close": 184.5,
    "volume": 714461.0
  },
  {
    "Unnamed: 0.1": 1560,
    "Unnamed: 0": 1944,
    "time": 1685044500,
    "open": 184.5,
    "high": 184.68,
    "low": 184.34,
    "close": 184.44,
    "volume": 1281784.0
  },
  {
    "Unnamed: 0.1": 1561,
    "Unnamed: 0": 1945,
    "time": 1685044800,
    "open": 184.41,
    "high": 184.53,
    "low": 184.29,
    "close": 184.36,
    "volume": 2252427.0
  },
  {
    "Unnamed: 0.1": 1562,
    "Unnamed: 0": 1946,
    "time": 1685045100,
    "open": 184.36,
    "high": 184.47,
    "low": 184.25,
    "close": 184.27,
    "volume": 17136.0
  },
  {
    "Unnamed: 0.1": 1563,
    "Unnamed: 0": 1947,
    "time": 1685045400,
    "open": 184.26,
    "high": 184.47,
    "low": 184.08,
    "close": 184.14,
    "volume": 26795.0
  },
  {
    "Unnamed: 0.1": 1564,
    "Unnamed: 0": 1948,
    "time": 1685045700,
    "open": 184.28,
    "high": 184.3,
    "low": 184.0,
    "close": 184.1,
    "volume": 23072.0
  },
  {
    "Unnamed: 0.1": 1565,
    "Unnamed: 0": 1949,
    "time": 1685046000,
    "open": 184.05,
    "high": 184.13,
    "low": 183.87,
    "close": 183.94,
    "volume": 26375.0
  },
  {
    "Unnamed: 0.1": 1566,
    "Unnamed: 0": 1950,
    "time": 1685046300,
    "open": 183.96,
    "high": 184.25,
    "low": 183.88,
    "close": 184.2,
    "volume": 31547.0
  },
  {
    "Unnamed: 0.1": 1567,
    "Unnamed: 0": 1951,
    "time": 1685046600,
    "open": 184.11,
    "high": 184.47,
    "low": 184.09,
    "close": 184.18,
    "volume": 670082.0
  },
  {
    "Unnamed: 0.1": 1568,
    "Unnamed: 0": 1952,
    "time": 1685046900,
    "open": 184.27,
    "high": 184.33,
    "low": 184.2,
    "close": 184.22,
    "volume": 15575.0
  },
  {
    "Unnamed: 0.1": 1569,
    "Unnamed: 0": 1953,
    "time": 1685047200,
    "open": 184.29,
    "high": 184.29,
    "low": 183.94,
    "close": 184.0,
    "volume": 17145.0
  },
  {
    "Unnamed: 0.1": 1570,
    "Unnamed: 0": 1954,
    "time": 1685047500,
    "open": 184.06,
    "high": 184.09,
    "low": 184.0,
    "close": 184.09,
    "volume": 5888.0
  },
  {
    "Unnamed: 0.1": 1571,
    "Unnamed: 0": 1955,
    "time": 1685047800,
    "open": 184.01,
    "high": 184.1,
    "low": 184.0,
    "close": 184.06,
    "volume": 4515.0
  },
  {
    "Unnamed: 0.1": 1572,
    "Unnamed: 0": 1956,
    "time": 1685048100,
    "open": 184.03,
    "high": 184.04,
    "low": 183.9,
    "close": 183.95,
    "volume": 11790.0
  },
  {
    "Unnamed: 0.1": 1573,
    "Unnamed: 0": 1957,
    "time": 1685048400,
    "open": 183.9,
    "high": 184.08,
    "low": 183.9,
    "close": 184.02,
    "volume": 5387.0
  },
  {
    "Unnamed: 0.1": 1574,
    "Unnamed: 0": 1958,
    "time": 1685048700,
    "open": 184.04,
    "high": 184.1,
    "low": 184.03,
    "close": 184.09,
    "volume": 1431.0
  },
  {
    "Unnamed: 0.1": 1575,
    "Unnamed: 0": 1959,
    "time": 1685049000,
    "open": 184.06,
    "high": 184.06,
    "low": 184.0,
    "close": 184.02,
    "volume": 4687.0
  },
  {
    "Unnamed: 0.1": 1576,
    "Unnamed: 0": 1960,
    "time": 1685049300,
    "open": 184.02,
    "high": 184.06,
    "low": 184.0,
    "close": 184.01,
    "volume": 4579.0
  },
  {
    "Unnamed: 0.1": 1577,
    "Unnamed: 0": 1961,
    "time": 1685049600,
    "open": 184.03,
    "high": 184.05,
    "low": 183.94,
    "close": 183.99,
    "volume": 4763.0
  },
  {
    "Unnamed: 0.1": 1578,
    "Unnamed: 0": 1962,
    "time": 1685049900,
    "open": 183.99,
    "high": 184.8,
    "low": 183.99,
    "close": 184.39,
    "volume": 24759.0
  },
  {
    "Unnamed: 0.1": 1579,
    "Unnamed: 0": 1963,
    "time": 1685050200,
    "open": 184.31,
    "high": 184.64,
    "low": 184.2,
    "close": 184.2,
    "volume": 6600.0
  },
  {
    "Unnamed: 0.1": 1580,
    "Unnamed: 0": 1964,
    "time": 1685050500,
    "open": 184.45,
    "high": 184.45,
    "low": 184.2,
    "close": 184.45,
    "volume": 11233.0
  },
  {
    "Unnamed: 0.1": 1581,
    "Unnamed: 0": 1965,
    "time": 1685050800,
    "open": 184.44,
    "high": 184.57,
    "low": 184.2,
    "close": 184.55,
    "volume": 23926.0
  },
  {
    "Unnamed: 0.1": 1582,
    "Unnamed: 0": 1966,
    "time": 1685051100,
    "open": 184.55,
    "high": 185.5,
    "low": 184.55,
    "close": 185.44,
    "volume": 64326.0
  },
  {
    "Unnamed: 0.1": 1583,
    "Unnamed: 0": 1967,
    "time": 1685051400,
    "open": 185.44,
    "high": 185.44,
    "low": 185.0,
    "close": 185.05,
    "volume": 23727.0
  },
  {
    "Unnamed: 0.1": 1584,
    "Unnamed: 0": 1968,
    "time": 1685051700,
    "open": 185.05,
    "high": 185.2,
    "low": 184.79,
    "close": 184.8,
    "volume": 11357.0
  },
  {
    "Unnamed: 0.1": 1585,
    "Unnamed: 0": 1969,
    "time": 1685052000,
    "open": 184.8,
    "high": 184.88,
    "low": 184.6,
    "close": 184.62,
    "volume": 13141.0
  },
  {
    "Unnamed: 0.1": 1586,
    "Unnamed: 0": 1970,
    "time": 1685052300,
    "open": 184.94,
    "high": 185.1,
    "low": 184.78,
    "close": 184.91,
    "volume": 6682.0
  },
  {
    "Unnamed: 0.1": 1587,
    "Unnamed: 0": 1971,
    "time": 1685052600,
    "open": 184.85,
    "high": 184.85,
    "low": 184.7,
    "close": 184.7,
    "volume": 6543.0
  },
  {
    "Unnamed: 0.1": 1588,
    "Unnamed: 0": 1972,
    "time": 1685052900,
    "open": 184.7,
    "high": 184.85,
    "low": 184.5,
    "close": 184.7,
    "volume": 8928.0
  },
  {
    "Unnamed: 0.1": 1589,
    "Unnamed: 0": 1973,
    "time": 1685053200,
    "open": 184.7,
    "high": 184.74,
    "low": 184.65,
    "close": 184.72,
    "volume": 3581.0
  },
  {
    "Unnamed: 0.1": 1590,
    "Unnamed: 0": 1974,
    "time": 1685053500,
    "open": 184.72,
    "high": 184.85,
    "low": 184.72,
    "close": 184.84,
    "volume": 2015.0
  },
  {
    "Unnamed: 0.1": 1591,
    "Unnamed: 0": 1975,
    "time": 1685053800,
    "open": 184.85,
    "high": 184.85,
    "low": 184.65,
    "close": 184.75,
    "volume": 12217.0
  },
  {
    "Unnamed: 0.1": 1592,
    "Unnamed: 0": 1976,
    "time": 1685054100,
    "open": 184.65,
    "high": 184.78,
    "low": 184.61,
    "close": 184.75,
    "volume": 6681.0
  },
  {
    "Unnamed: 0.1": 1593,
    "Unnamed: 0": 1977,
    "time": 1685054400,
    "open": 184.78,
    "high": 184.8,
    "low": 184.74,
    "close": 184.8,
    "volume": 5946.0
  },
  {
    "Unnamed: 0.1": 1594,
    "Unnamed: 0": 1978,
    "time": 1685054700,
    "open": 184.81,
    "high": 184.81,
    "low": 184.66,
    "close": 184.81,
    "volume": 4878.0
  },
  {
    "Unnamed: 0.1": 1595,
    "Unnamed: 0": 1979,
    "time": 1685055000,
    "open": 184.81,
    "high": 184.81,
    "low": 184.81,
    "close": 184.81,
    "volume": 2234.0
  },
  {
    "Unnamed: 0.1": 1596,
    "Unnamed: 0": 1980,
    "time": 1685055300,
    "open": 184.81,
    "high": 184.81,
    "low": 184.66,
    "close": 184.67,
    "volume": 3454.0
  },
  {
    "Unnamed: 0.1": 1597,
    "Unnamed: 0": 1981,
    "time": 1685055600,
    "open": 184.68,
    "high": 184.74,
    "low": 184.51,
    "close": 184.51,
    "volume": 12573.0
  },
  {
    "Unnamed: 0.1": 1598,
    "Unnamed: 0": 1982,
    "time": 1685055900,
    "open": 184.55,
    "high": 184.55,
    "low": 184.15,
    "close": 184.2,
    "volume": 12845.0
  },
  {
    "Unnamed: 0.1": 1599,
    "Unnamed: 0": 1983,
    "time": 1685056200,
    "open": 184.21,
    "high": 184.21,
    "low": 183.92,
    "close": 184.02,
    "volume": 21997.0
  },
  {
    "Unnamed: 0.1": 1600,
    "Unnamed: 0": 1984,
    "time": 1685056500,
    "open": 184.08,
    "high": 184.17,
    "low": 184.08,
    "close": 184.11,
    "volume": 18027.0
  },
  {
    "Unnamed: 0.1": 1601,
    "Unnamed: 0": 1985,
    "time": 1685056800,
    "open": 184.15,
    "high": 184.15,
    "low": 184.12,
    "close": 184.15,
    "volume": 11378.0
  },
  {
    "Unnamed: 0.1": 1602,
    "Unnamed: 0": 1986,
    "time": 1685057100,
    "open": 184.26,
    "high": 184.92,
    "low": 184.15,
    "close": 184.26,
    "volume": 22882.0
  },
  {
    "Unnamed: 0.1": 1603,
    "Unnamed: 0": 1987,
    "time": 1685057400,
    "open": 184.3,
    "high": 184.4,
    "low": 184.23,
    "close": 184.36,
    "volume": 2494.0
  },
  {
    "Unnamed: 0.1": 1604,
    "Unnamed: 0": 1988,
    "time": 1685057700,
    "open": 184.41,
    "high": 184.5,
    "low": 184.33,
    "close": 184.4,
    "volume": 7065.0
  },
  {
    "Unnamed: 0.1": 1605,
    "Unnamed: 0": 1989,
    "time": 1685058000,
    "open": 184.47,
    "high": 184.65,
    "low": 184.47,
    "close": 184.6,
    "volume": 22634.0
  },
  {
    "Unnamed: 0.1": 1606,
    "Unnamed: 0": 1990,
    "time": 1685058300,
    "open": 184.6,
    "high": 184.6,
    "low": 184.43,
    "close": 184.52,
    "volume": 7242.0
  },
  {
    "Unnamed: 0.1": 1607,
    "Unnamed: 0": 1991,
    "time": 1685058600,
    "open": 184.5,
    "high": 184.55,
    "low": 184.45,
    "close": 184.5,
    "volume": 7078.0
  },
  {
    "Unnamed: 0.1": 1608,
    "Unnamed: 0": 1992,
    "time": 1685058900,
    "open": 184.52,
    "high": 184.55,
    "low": 184.45,
    "close": 184.47,
    "volume": 16478.0
  },
  {
    "Unnamed: 0.1": 1609,
    "Unnamed: 0": 1993,
    "time": 1685088000,
    "open": 184.39,
    "high": 184.5,
    "low": 184.0,
    "close": 184.22,
    "volume": 5191.0
  },
  {
    "Unnamed: 0.1": 1610,
    "Unnamed: 0": 1994,
    "time": 1685088300,
    "open": 184.3,
    "high": 184.39,
    "low": 184.3,
    "close": 184.31,
    "volume": 879.0
  },
  {
    "Unnamed: 0.1": 1611,
    "Unnamed: 0": 1995,
    "time": 1685088600,
    "open": 184.3,
    "high": 184.5,
    "low": 184.22,
    "close": 184.5,
    "volume": 1157.0
  },
  {
    "Unnamed: 0.1": 1612,
    "Unnamed: 0": 1996,
    "time": 1685088900,
    "open": 184.48,
    "high": 184.85,
    "low": 184.48,
    "close": 184.85,
    "volume": 1252.0
  },
  {
    "Unnamed: 0.1": 1613,
    "Unnamed: 0": 1997,
    "time": 1685089200,
    "open": 184.77,
    "high": 185.0,
    "low": 184.77,
    "close": 184.99,
    "volume": 2660.0
  },
  {
    "Unnamed: 0.1": 1614,
    "Unnamed: 0": 1998,
    "time": 1685089500,
    "open": 184.99,
    "high": 185.44,
    "low": 184.99,
    "close": 185.44,
    "volume": 1523.0
  },
  {
    "Unnamed: 0.1": 1615,
    "Unnamed: 0": 1999,
    "time": 1685089800,
    "open": 185.41,
    "high": 185.6,
    "low": 185.41,
    "close": 185.48,
    "volume": 6223.0
  },
  {
    "Unnamed: 0.1": 1616,
    "Unnamed: 0": 2000,
    "time": 1685090100,
    "open": 185.48,
    "high": 185.5,
    "low": 185.31,
    "close": 185.42,
    "volume": 2592.0
  },
  {
    "Unnamed: 0.1": 1617,
    "Unnamed: 0": 2001,
    "time": 1685090400,
    "open": 185.43,
    "high": 185.59,
    "low": 185.41,
    "close": 185.57,
    "volume": 1841.0
  },
  {
    "Unnamed: 0.1": 1618,
    "Unnamed: 0": 2002,
    "time": 1685090700,
    "open": 185.6,
    "high": 185.9,
    "low": 185.6,
    "close": 185.8,
    "volume": 3654.0
  },
  {
    "Unnamed: 0.1": 1619,
    "Unnamed: 0": 2003,
    "time": 1685091000,
    "open": 185.8,
    "high": 185.8,
    "low": 185.55,
    "close": 185.58,
    "volume": 1897.0
  },
  {
    "Unnamed: 0.1": 1620,
    "Unnamed: 0": 2004,
    "time": 1685091300,
    "open": 185.59,
    "high": 185.59,
    "low": 185.39,
    "close": 185.43,
    "volume": 2082.0
  },
  {
    "Unnamed: 0.1": 1621,
    "Unnamed: 0": 2005,
    "time": 1685091600,
    "open": 185.46,
    "high": 185.57,
    "low": 185.46,
    "close": 185.57,
    "volume": 200.0
  },
  {
    "Unnamed: 0.1": 1622,
    "Unnamed: 0": 2006,
    "time": 1685091900,
    "open": 185.46,
    "high": 185.46,
    "low": 185.22,
    "close": 185.25,
    "volume": 2896.0
  },
  {
    "Unnamed: 0.1": 1623,
    "Unnamed: 0": 2007,
    "time": 1685092200,
    "open": 185.2,
    "high": 185.2,
    "low": 185.1,
    "close": 185.19,
    "volume": 638.0
  },
  {
    "Unnamed: 0.1": 1624,
    "Unnamed: 0": 2008,
    "time": 1685092500,
    "open": 185.1,
    "high": 185.28,
    "low": 185.06,
    "close": 185.15,
    "volume": 780.0
  },
  {
    "Unnamed: 0.1": 1625,
    "Unnamed: 0": 2009,
    "time": 1685092800,
    "open": 185.01,
    "high": 185.1,
    "low": 185.0,
    "close": 185.1,
    "volume": 546.0
  },
  {
    "Unnamed: 0.1": 1626,
    "Unnamed: 0": 2010,
    "time": 1685093100,
    "open": 185.2,
    "high": 185.31,
    "low": 185.2,
    "close": 185.31,
    "volume": 1038.0
  },
  {
    "Unnamed: 0.1": 1627,
    "Unnamed: 0": 2011,
    "time": 1685093400,
    "open": 185.27,
    "high": 185.3,
    "low": 185.2,
    "close": 185.3,
    "volume": 862.0
  },
  {
    "Unnamed: 0.1": 1628,
    "Unnamed: 0": 2012,
    "time": 1685093700,
    "open": 185.36,
    "high": 185.52,
    "low": 185.36,
    "close": 185.52,
    "volume": 2416.0
  },
  {
    "Unnamed: 0.1": 1629,
    "Unnamed: 0": 2013,
    "time": 1685094000,
    "open": 185.45,
    "high": 185.45,
    "low": 185.4,
    "close": 185.44,
    "volume": 380.0
  },
  {
    "Unnamed: 0.1": 1630,
    "Unnamed: 0": 2014,
    "time": 1685094300,
    "open": 185.44,
    "high": 185.47,
    "low": 185.4,
    "close": 185.47,
    "volume": 1271.0
  },
  {
    "Unnamed: 0.1": 1631,
    "Unnamed: 0": 2015,
    "time": 1685094600,
    "open": 185.47,
    "high": 185.47,
    "low": 185.41,
    "close": 185.44,
    "volume": 1447.0
  },
  {
    "Unnamed: 0.1": 1632,
    "Unnamed: 0": 2016,
    "time": 1685094900,
    "open": 185.44,
    "high": 185.5,
    "low": 185.44,
    "close": 185.45,
    "volume": 1050.0
  },
  {
    "Unnamed: 0.1": 1633,
    "Unnamed: 0": 2017,
    "time": 1685095200,
    "open": 185.5,
    "high": 185.5,
    "low": 185.24,
    "close": 185.24,
    "volume": 648.0
  },
  {
    "Unnamed: 0.1": 1634,
    "Unnamed: 0": 2018,
    "time": 1685095500,
    "open": 185.23,
    "high": 185.24,
    "low": 185.15,
    "close": 185.16,
    "volume": 641.0
  },
  {
    "Unnamed: 0.1": 1635,
    "Unnamed: 0": 2019,
    "time": 1685095800,
    "open": 185.06,
    "high": 185.07,
    "low": 185.05,
    "close": 185.07,
    "volume": 1215.0
  },
  {
    "Unnamed: 0.1": 1636,
    "Unnamed: 0": 2020,
    "time": 1685096100,
    "open": 185.07,
    "high": 185.09,
    "low": 184.99,
    "close": 184.99,
    "volume": 3147.0
  },
  {
    "Unnamed: 0.1": 1637,
    "Unnamed: 0": 2021,
    "time": 1685096400,
    "open": 185.0,
    "high": 185.0,
    "low": 184.97,
    "close": 185.0,
    "volume": 1849.0
  },
  {
    "Unnamed: 0.1": 1638,
    "Unnamed: 0": 2022,
    "time": 1685096700,
    "open": 184.98,
    "high": 185.0,
    "low": 184.92,
    "close": 185.0,
    "volume": 1783.0
  },
  {
    "Unnamed: 0.1": 1639,
    "Unnamed: 0": 2023,
    "time": 1685097000,
    "open": 184.99,
    "high": 185.0,
    "low": 184.99,
    "close": 184.99,
    "volume": 2895.0
  },
  {
    "Unnamed: 0.1": 1640,
    "Unnamed: 0": 2024,
    "time": 1685097300,
    "open": 185.0,
    "high": 185.0,
    "low": 184.86,
    "close": 185.0,
    "volume": 6270.0
  },
  {
    "Unnamed: 0.1": 1641,
    "Unnamed: 0": 2025,
    "time": 1685097600,
    "open": 185.0,
    "high": 185.17,
    "low": 184.85,
    "close": 185.17,
    "volume": 7887.0
  },
  {
    "Unnamed: 0.1": 1642,
    "Unnamed: 0": 2026,
    "time": 1685097900,
    "open": 185.18,
    "high": 185.3,
    "low": 185.07,
    "close": 185.1,
    "volume": 5225.0
  },
  {
    "Unnamed: 0.1": 1643,
    "Unnamed: 0": 2027,
    "time": 1685098200,
    "open": 185.11,
    "high": 185.2,
    "low": 185.11,
    "close": 185.2,
    "volume": 687.0
  },
  {
    "Unnamed: 0.1": 1644,
    "Unnamed: 0": 2028,
    "time": 1685098500,
    "open": 185.23,
    "high": 185.23,
    "low": 184.87,
    "close": 185.0,
    "volume": 1369.0
  },
  {
    "Unnamed: 0.1": 1645,
    "Unnamed: 0": 2029,
    "time": 1685098800,
    "open": 185.0,
    "high": 185.85,
    "low": 184.88,
    "close": 185.69,
    "volume": 35992.0
  },
  {
    "Unnamed: 0.1": 1646,
    "Unnamed: 0": 2030,
    "time": 1685099100,
    "open": 185.7,
    "high": 185.88,
    "low": 185.6,
    "close": 185.6,
    "volume": 12554.0
  },
  {
    "Unnamed: 0.1": 1647,
    "Unnamed: 0": 2031,
    "time": 1685099400,
    "open": 185.69,
    "high": 185.99,
    "low": 185.69,
    "close": 185.83,
    "volume": 12412.0
  },
  {
    "Unnamed: 0.1": 1648,
    "Unnamed: 0": 2032,
    "time": 1685099700,
    "open": 185.75,
    "high": 185.8,
    "low": 185.68,
    "close": 185.69,
    "volume": 3733.0
  },
  {
    "Unnamed: 0.1": 1649,
    "Unnamed: 0": 2033,
    "time": 1685100000,
    "open": 185.64,
    "high": 185.64,
    "low": 185.4,
    "close": 185.55,
    "volume": 9264.0
  },
  {
    "Unnamed: 0.1": 1650,
    "Unnamed: 0": 2034,
    "time": 1685100300,
    "open": 185.55,
    "high": 185.94,
    "low": 185.55,
    "close": 185.94,
    "volume": 14494.0
  },
  {
    "Unnamed: 0.1": 1651,
    "Unnamed: 0": 2035,
    "time": 1685100600,
    "open": 185.85,
    "high": 185.9,
    "low": 185.85,
    "close": 185.9,
    "volume": 5696.0
  },
  {
    "Unnamed: 0.1": 1652,
    "Unnamed: 0": 2036,
    "time": 1685100900,
    "open": 185.93,
    "high": 185.94,
    "low": 185.68,
    "close": 185.71,
    "volume": 4434.0
  },
  {
    "Unnamed: 0.1": 1653,
    "Unnamed: 0": 2037,
    "time": 1685101200,
    "open": 185.73,
    "high": 185.9,
    "low": 185.71,
    "close": 185.8,
    "volume": 3790.0
  },
  {
    "Unnamed: 0.1": 1654,
    "Unnamed: 0": 2038,
    "time": 1685101500,
    "open": 185.8,
    "high": 185.92,
    "low": 185.8,
    "close": 185.92,
    "volume": 5005.0
  },
  {
    "Unnamed: 0.1": 1655,
    "Unnamed: 0": 2039,
    "time": 1685101800,
    "open": 185.87,
    "high": 185.97,
    "low": 185.58,
    "close": 185.58,
    "volume": 14560.0
  },
  {
    "Unnamed: 0.1": 1656,
    "Unnamed: 0": 2040,
    "time": 1685102100,
    "open": 185.58,
    "high": 185.68,
    "low": 185.51,
    "close": 185.51,
    "volume": 6114.0
  },
  {
    "Unnamed: 0.1": 1657,
    "Unnamed: 0": 2041,
    "time": 1685102400,
    "open": 185.14,
    "high": 185.98,
    "low": 183.7,
    "close": 185.54,
    "volume": 132802.0
  },
  {
    "Unnamed: 0.1": 1658,
    "Unnamed: 0": 2042,
    "time": 1685102700,
    "open": 185.53,
    "high": 185.59,
    "low": 185.3,
    "close": 185.38,
    "volume": 34459.0
  },
  {
    "Unnamed: 0.1": 1659,
    "Unnamed: 0": 2043,
    "time": 1685103000,
    "open": 185.4,
    "high": 185.7,
    "low": 185.37,
    "close": 185.37,
    "volume": 22021.0
  },
  {
    "Unnamed: 0.1": 1660,
    "Unnamed: 0": 2044,
    "time": 1685103300,
    "open": 185.37,
    "high": 185.49,
    "low": 185.35,
    "close": 185.4,
    "volume": 7083.0
  },
  {
    "Unnamed: 0.1": 1661,
    "Unnamed: 0": 2045,
    "time": 1685103600,
    "open": 185.41,
    "high": 185.51,
    "low": 185.25,
    "close": 185.46,
    "volume": 24179.0
  },
  {
    "Unnamed: 0.1": 1662,
    "Unnamed: 0": 2046,
    "time": 1685103900,
    "open": 185.42,
    "high": 185.47,
    "low": 185.33,
    "close": 185.43,
    "volume": 13408.0
  },
  {
    "Unnamed: 0.1": 1663,
    "Unnamed: 0": 2047,
    "time": 1685104200,
    "open": 185.4,
    "high": 185.6,
    "low": 184.82,
    "close": 185.23,
    "volume": 80732.0
  },
  {
    "Unnamed: 0.1": 1664,
    "Unnamed: 0": 2048,
    "time": 1685104500,
    "open": 185.16,
    "high": 185.25,
    "low": 184.26,
    "close": 184.26,
    "volume": 61961.0
  },
  {
    "Unnamed: 0.1": 1665,
    "Unnamed: 0": 2049,
    "time": 1685104800,
    "open": 184.26,
    "high": 184.8,
    "low": 184.09,
    "close": 184.63,
    "volume": 49778.0
  },
  {
    "Unnamed: 0.1": 1666,
    "Unnamed: 0": 2050,
    "time": 1685105100,
    "open": 184.63,
    "high": 185.13,
    "low": 184.35,
    "close": 184.9,
    "volume": 42555.0
  },
  {
    "Unnamed: 0.1": 1667,
    "Unnamed: 0": 2051,
    "time": 1685105400,
    "open": 185.0,
    "high": 185.04,
    "low": 184.65,
    "close": 185.04,
    "volume": 24877.0
  },
  {
    "Unnamed: 0.1": 1668,
    "Unnamed: 0": 2052,
    "time": 1685105700,
    "open": 185.0,
    "high": 185.08,
    "low": 184.72,
    "close": 185.0,
    "volume": 15189.0
  },
  {
    "Unnamed: 0.1": 1669,
    "Unnamed: 0": 2053,
    "time": 1685106000,
    "open": 184.94,
    "high": 185.1,
    "low": 184.64,
    "close": 184.85,
    "volume": 43348.0
  },
  {
    "Unnamed: 0.1": 1670,
    "Unnamed: 0": 2054,
    "time": 1685106300,
    "open": 184.82,
    "high": 185.08,
    "low": 184.75,
    "close": 184.8,
    "volume": 15621.0
  },
  {
    "Unnamed: 0.1": 1671,
    "Unnamed: 0": 2055,
    "time": 1685106600,
    "open": 184.83,
    "high": 185.27,
    "low": 184.75,
    "close": 185.2,
    "volume": 43769.0
  },
  {
    "Unnamed: 0.1": 1672,
    "Unnamed: 0": 2056,
    "time": 1685106900,
    "open": 185.19,
    "high": 185.19,
    "low": 184.87,
    "close": 185.0,
    "volume": 18150.0
  },
  {
    "Unnamed: 0.1": 1673,
    "Unnamed: 0": 2057,
    "time": 1685107200,
    "open": 185.09,
    "high": 185.39,
    "low": 185.0,
    "close": 185.2,
    "volume": 22540.0
  },
  {
    "Unnamed: 0.1": 1674,
    "Unnamed: 0": 2058,
    "time": 1685107500,
    "open": 185.12,
    "high": 185.15,
    "low": 184.5,
    "close": 184.51,
    "volume": 53562.0
  },
  {
    "Unnamed: 0.1": 1675,
    "Unnamed: 0": 2059,
    "time": 1685107800,
    "open": 184.62,
    "high": 186.97,
    "low": 184.53,
    "close": 186.73,
    "volume": 3062929.0
  },
  {
    "Unnamed: 0.1": 1676,
    "Unnamed: 0": 2060,
    "time": 1685108100,
    "open": 186.71,
    "high": 188.4,
    "low": 186.06,
    "close": 187.94,
    "volume": 3672718.0
  },
  {
    "Unnamed: 0.1": 1677,
    "Unnamed: 0": 2061,
    "time": 1685108400,
    "open": 187.94,
    "high": 188.27,
    "low": 187.52,
    "close": 187.53,
    "volume": 2497943.0
  },
  {
    "Unnamed: 0.1": 1678,
    "Unnamed: 0": 2062,
    "time": 1685108700,
    "open": 187.52,
    "high": 188.16,
    "low": 186.97,
    "close": 187.34,
    "volume": 2514770.0
  },
  {
    "Unnamed: 0.1": 1679,
    "Unnamed: 0": 2063,
    "time": 1685109000,
    "open": 187.34,
    "high": 188.63,
    "low": 187.3,
    "close": 188.38,
    "volume": 2286367.0
  },
  {
    "Unnamed: 0.1": 1680,
    "Unnamed: 0": 2064,
    "time": 1685109300,
    "open": 188.37,
    "high": 189.22,
    "low": 188.3,
    "close": 189.16,
    "volume": 2527779.0
  },
  {
    "Unnamed: 0.1": 1681,
    "Unnamed: 0": 2065,
    "time": 1685109600,
    "open": 189.18,
    "high": 189.96,
    "low": 189.0,
    "close": 189.53,
    "volume": 2665416.0
  },
  {
    "Unnamed: 0.1": 1682,
    "Unnamed: 0": 2066,
    "time": 1685109900,
    "open": 189.52,
    "high": 189.93,
    "low": 188.9,
    "close": 189.74,
    "volume": 2386135.0
  },
  {
    "Unnamed: 0.1": 1683,
    "Unnamed: 0": 2067,
    "time": 1685110200,
    "open": 189.79,
    "high": 190.61,
    "low": 189.54,
    "close": 190.56,
    "volume": 2685790.0
  },
  {
    "Unnamed: 0.1": 1684,
    "Unnamed: 0": 2068,
    "time": 1685110500,
    "open": 190.56,
    "high": 190.73,
    "low": 190.02,
    "close": 190.4,
    "volume": 2092301.0
  },
  {
    "Unnamed: 0.1": 1685,
    "Unnamed: 0": 2069,
    "time": 1685110800,
    "open": 190.4,
    "high": 190.51,
    "low": 189.56,
    "close": 189.96,
    "volume": 2048051.0
  },
  {
    "Unnamed: 0.1": 1686,
    "Unnamed: 0": 2070,
    "time": 1685111100,
    "open": 189.98,
    "high": 190.43,
    "low": 189.95,
    "close": 190.28,
    "volume": 1356941.0
  },
  {
    "Unnamed: 0.1": 1687,
    "Unnamed: 0": 2071,
    "time": 1685111400,
    "open": 190.28,
    "high": 190.49,
    "low": 189.71,
    "close": 190.25,
    "volume": 1510664.0
  },
  {
    "Unnamed: 0.1": 1688,
    "Unnamed: 0": 2072,
    "time": 1685111700,
    "open": 190.25,
    "high": 191.2,
    "low": 190.2,
    "close": 191.05,
    "volume": 2401568.0
  },
  {
    "Unnamed: 0.1": 1689,
    "Unnamed: 0": 2073,
    "time": 1685112000,
    "open": 191.07,
    "high": 191.38,
    "low": 190.75,
    "close": 190.86,
    "volume": 1908080.0
  },
  {
    "Unnamed: 0.1": 1690,
    "Unnamed: 0": 2074,
    "time": 1685112300,
    "open": 190.84,
    "high": 191.11,
    "low": 190.76,
    "close": 190.95,
    "volume": 1212999.0
  },
  {
    "Unnamed: 0.1": 1691,
    "Unnamed: 0": 2075,
    "time": 1685112600,
    "open": 190.95,
    "high": 191.1,
    "low": 190.4,
    "close": 190.97,
    "volume": 1375814.0
  },
  {
    "Unnamed: 0.1": 1692,
    "Unnamed: 0": 2076,
    "time": 1685112900,
    "open": 190.97,
    "high": 191.53,
    "low": 190.71,
    "close": 191.31,
    "volume": 1636935.0
  },
  {
    "Unnamed: 0.1": 1693,
    "Unnamed: 0": 2077,
    "time": 1685113200,
    "open": 191.31,
    "high": 191.38,
    "low": 190.81,
    "close": 191.02,
    "volume": 1359457.0
  },
  {
    "Unnamed: 0.1": 1694,
    "Unnamed: 0": 2078,
    "time": 1685113500,
    "open": 191.01,
    "high": 191.1,
    "low": 190.5,
    "close": 190.87,
    "volume": 1244548.0
  },
  {
    "Unnamed: 0.1": 1695,
    "Unnamed: 0": 2079,
    "time": 1685113800,
    "open": 190.84,
    "high": 190.98,
    "low": 190.12,
    "close": 190.71,
    "volume": 1301854.0
  },
  {
    "Unnamed: 0.1": 1696,
    "Unnamed: 0": 2080,
    "time": 1685114100,
    "open": 190.72,
    "high": 191.01,
    "low": 190.35,
    "close": 190.75,
    "volume": 1151250.0
  },
  {
    "Unnamed: 0.1": 1697,
    "Unnamed: 0": 2081,
    "time": 1685114400,
    "open": 190.75,
    "high": 191.15,
    "low": 190.68,
    "close": 191.02,
    "volume": 1240240.0
  },
  {
    "Unnamed: 0.1": 1698,
    "Unnamed: 0": 2082,
    "time": 1685114700,
    "open": 191.04,
    "high": 191.4,
    "low": 190.9,
    "close": 191.23,
    "volume": 1162304.0
  },
  {
    "Unnamed: 0.1": 1699,
    "Unnamed: 0": 2083,
    "time": 1685115000,
    "open": 191.24,
    "high": 191.95,
    "low": 191.24,
    "close": 191.82,
    "volume": 1718653.0
  },
  {
    "Unnamed: 0.1": 1700,
    "Unnamed: 0": 2084,
    "time": 1685115300,
    "open": 191.8,
    "high": 191.99,
    "low": 191.6,
    "close": 191.98,
    "volume": 1132471.0
  },
  {
    "Unnamed: 0.1": 1701,
    "Unnamed: 0": 2085,
    "time": 1685115600,
    "open": 191.99,
    "high": 192.74,
    "low": 191.85,
    "close": 192.71,
    "volume": 1628788.0
  },
  {
    "Unnamed: 0.1": 1702,
    "Unnamed: 0": 2086,
    "time": 1685115900,
    "open": 192.71,
    "high": 193.77,
    "low": 192.32,
    "close": 193.61,
    "volume": 2358442.0
  },
  {
    "Unnamed: 0.1": 1703,
    "Unnamed: 0": 2087,
    "time": 1685116200,
    "open": 193.64,
    "high": 194.53,
    "low": 193.61,
    "close": 194.21,
    "volume": 2804844.0
  },
  {
    "Unnamed: 0.1": 1704,
    "Unnamed: 0": 2088,
    "time": 1685116500,
    "open": 194.21,
    "high": 194.85,
    "low": 194.04,
    "close": 194.51,
    "volume": 1868434.0
  },
  {
    "Unnamed: 0.1": 1705,
    "Unnamed: 0": 2089,
    "time": 1685116800,
    "open": 194.52,
    "high": 194.68,
    "low": 194.1,
    "close": 194.42,
    "volume": 1571368.0
  },
  {
    "Unnamed: 0.1": 1706,
    "Unnamed: 0": 2090,
    "time": 1685117100,
    "open": 194.44,
    "high": 194.49,
    "low": 193.61,
    "close": 193.85,
    "volume": 1444228.0
  },
  {
    "Unnamed: 0.1": 1707,
    "Unnamed: 0": 2091,
    "time": 1685117400,
    "open": 193.85,
    "high": 194.3,
    "low": 193.81,
    "close": 194.22,
    "volume": 1283667.0
  },
  {
    "Unnamed: 0.1": 1708,
    "Unnamed: 0": 2092,
    "time": 1685117700,
    "open": 194.22,
    "high": 194.35,
    "low": 193.88,
    "close": 194.1,
    "volume": 1021951.0
  },
  {
    "Unnamed: 0.1": 1709,
    "Unnamed: 0": 2093,
    "time": 1685118000,
    "open": 194.08,
    "high": 194.43,
    "low": 193.72,
    "close": 193.93,
    "volume": 1317942.0
  },
  {
    "Unnamed: 0.1": 1710,
    "Unnamed: 0": 2094,
    "time": 1685118300,
    "open": 193.95,
    "high": 194.15,
    "low": 193.81,
    "close": 194.14,
    "volume": 897946.0
  },
  {
    "Unnamed: 0.1": 1711,
    "Unnamed: 0": 2095,
    "time": 1685118600,
    "open": 194.14,
    "high": 194.85,
    "low": 193.97,
    "close": 194.76,
    "volume": 1785279.0
  },
  {
    "Unnamed: 0.1": 1712,
    "Unnamed: 0": 2096,
    "time": 1685118900,
    "open": 194.78,
    "high": 194.93,
    "low": 194.46,
    "close": 194.5,
    "volume": 1187912.0
  },
  {
    "Unnamed: 0.1": 1713,
    "Unnamed: 0": 2097,
    "time": 1685119200,
    "open": 194.48,
    "high": 195.0,
    "low": 194.47,
    "close": 194.87,
    "volume": 1101734.0
  },
  {
    "Unnamed: 0.1": 1714,
    "Unnamed: 0": 2098,
    "time": 1685119500,
    "open": 194.88,
    "high": 195.44,
    "low": 194.85,
    "close": 195.27,
    "volume": 1431107.0
  },
  {
    "Unnamed: 0.1": 1715,
    "Unnamed: 0": 2099,
    "time": 1685119800,
    "open": 195.27,
    "high": 195.75,
    "low": 195.27,
    "close": 195.54,
    "volume": 1518276.0
  },
  {
    "Unnamed: 0.1": 1716,
    "Unnamed: 0": 2100,
    "time": 1685120100,
    "open": 195.55,
    "high": 196.73,
    "low": 195.54,
    "close": 196.55,
    "volume": 2525074.0
  },
  {
    "Unnamed: 0.1": 1717,
    "Unnamed: 0": 2101,
    "time": 1685120400,
    "open": 196.56,
    "high": 197.58,
    "low": 196.48,
    "close": 197.41,
    "volume": 2439860.0
  },
  {
    "Unnamed: 0.1": 1718,
    "Unnamed: 0": 2102,
    "time": 1685120700,
    "open": 197.41,
    "high": 198.21,
    "low": 197.33,
    "close": 197.94,
    "volume": 2443147.0
  },
  {
    "Unnamed: 0.1": 1719,
    "Unnamed: 0": 2103,
    "time": 1685121000,
    "open": 197.94,
    "high": 198.6,
    "low": 197.87,
    "close": 198.22,
    "volume": 1984224.0
  },
  {
    "Unnamed: 0.1": 1720,
    "Unnamed: 0": 2104,
    "time": 1685121300,
    "open": 198.21,
    "high": 198.5,
    "low": 196.62,
    "close": 197.42,
    "volume": 2604340.0
  },
  {
    "Unnamed: 0.1": 1721,
    "Unnamed: 0": 2105,
    "time": 1685121600,
    "open": 197.46,
    "high": 197.48,
    "low": 196.65,
    "close": 196.93,
    "volume": 1722430.0
  },
  {
    "Unnamed: 0.1": 1722,
    "Unnamed: 0": 2106,
    "time": 1685121900,
    "open": 196.92,
    "high": 197.19,
    "low": 196.34,
    "close": 197.12,
    "volume": 1716175.0
  },
  {
    "Unnamed: 0.1": 1723,
    "Unnamed: 0": 2107,
    "time": 1685122200,
    "open": 197.14,
    "high": 197.79,
    "low": 196.8,
    "close": 197.53,
    "volume": 1532340.0
  },
  {
    "Unnamed: 0.1": 1724,
    "Unnamed: 0": 2108,
    "time": 1685122500,
    "open": 197.53,
    "high": 197.54,
    "low": 197.02,
    "close": 197.32,
    "volume": 1171769.0
  },
  {
    "Unnamed: 0.1": 1725,
    "Unnamed: 0": 2109,
    "time": 1685122800,
    "open": 197.33,
    "high": 197.33,
    "low": 196.17,
    "close": 196.41,
    "volume": 1753245.0
  },
  {
    "Unnamed: 0.1": 1726,
    "Unnamed: 0": 2110,
    "time": 1685123100,
    "open": 196.42,
    "high": 196.44,
    "low": 195.4,
    "close": 195.66,
    "volume": 1742905.0
  },
  {
    "Unnamed: 0.1": 1727,
    "Unnamed: 0": 2111,
    "time": 1685123400,
    "open": 195.66,
    "high": 196.39,
    "low": 195.51,
    "close": 196.14,
    "volume": 1516725.0
  },
  {
    "Unnamed: 0.1": 1728,
    "Unnamed: 0": 2112,
    "time": 1685123700,
    "open": 196.14,
    "high": 196.53,
    "low": 195.74,
    "close": 195.93,
    "volume": 1273004.0
  },
  {
    "Unnamed: 0.1": 1729,
    "Unnamed: 0": 2113,
    "time": 1685124000,
    "open": 195.93,
    "high": 196.03,
    "low": 195.17,
    "close": 195.61,
    "volume": 1453291.0
  },
  {
    "Unnamed: 0.1": 1730,
    "Unnamed: 0": 2114,
    "time": 1685124300,
    "open": 195.6,
    "high": 195.95,
    "low": 195.46,
    "close": 195.59,
    "volume": 1241825.0
  },
  {
    "Unnamed: 0.1": 1731,
    "Unnamed: 0": 2115,
    "time": 1685124600,
    "open": 195.58,
    "high": 196.15,
    "low": 195.32,
    "close": 196.11,
    "volume": 1342020.0
  },
  {
    "Unnamed: 0.1": 1732,
    "Unnamed: 0": 2116,
    "time": 1685124900,
    "open": 196.12,
    "high": 196.32,
    "low": 195.69,
    "close": 196.07,
    "volume": 1276314.0
  },
  {
    "Unnamed: 0.1": 1733,
    "Unnamed: 0": 2117,
    "time": 1685125200,
    "open": 196.07,
    "high": 196.54,
    "low": 195.98,
    "close": 196.37,
    "volume": 1197003.0
  },
  {
    "Unnamed: 0.1": 1734,
    "Unnamed: 0": 2118,
    "time": 1685125500,
    "open": 196.39,
    "high": 196.52,
    "low": 195.97,
    "close": 196.02,
    "volume": 1173298.0
  },
  {
    "Unnamed: 0.1": 1735,
    "Unnamed: 0": 2119,
    "time": 1685125800,
    "open": 196.02,
    "high": 196.17,
    "low": 195.36,
    "close": 195.81,
    "volume": 1281664.0
  },
  {
    "Unnamed: 0.1": 1736,
    "Unnamed: 0": 2120,
    "time": 1685126100,
    "open": 195.81,
    "high": 196.19,
    "low": 195.66,
    "close": 195.94,
    "volume": 1157209.0
  },
  {
    "Unnamed: 0.1": 1737,
    "Unnamed: 0": 2121,
    "time": 1685126400,
    "open": 195.95,
    "high": 196.43,
    "low": 195.51,
    "close": 196.41,
    "volume": 1238728.0
  },
  {
    "Unnamed: 0.1": 1738,
    "Unnamed: 0": 2122,
    "time": 1685126700,
    "open": 196.44,
    "high": 196.64,
    "low": 196.1,
    "close": 196.46,
    "volume": 1481045.0
  },
  {
    "Unnamed: 0.1": 1739,
    "Unnamed: 0": 2123,
    "time": 1685127000,
    "open": 196.46,
    "high": 196.54,
    "low": 196.21,
    "close": 196.47,
    "volume": 728676.0
  },
  {
    "Unnamed: 0.1": 1740,
    "Unnamed: 0": 2124,
    "time": 1685127300,
    "open": 196.47,
    "high": 196.75,
    "low": 195.97,
    "close": 196.08,
    "volume": 1413645.0
  },
  {
    "Unnamed: 0.1": 1741,
    "Unnamed: 0": 2125,
    "time": 1685127600,
    "open": 196.09,
    "high": 196.38,
    "low": 196.0,
    "close": 196.34,
    "volume": 883915.0
  },
  {
    "Unnamed: 0.1": 1742,
    "Unnamed: 0": 2126,
    "time": 1685127900,
    "open": 196.35,
    "high": 196.94,
    "low": 196.17,
    "close": 196.93,
    "volume": 1123465.0
  },
  {
    "Unnamed: 0.1": 1743,
    "Unnamed: 0": 2127,
    "time": 1685128200,
    "open": 196.91,
    "high": 197.25,
    "low": 196.4,
    "close": 196.64,
    "volume": 1651612.0
  },
  {
    "Unnamed: 0.1": 1744,
    "Unnamed: 0": 2128,
    "time": 1685128500,
    "open": 196.63,
    "high": 196.79,
    "low": 196.46,
    "close": 196.48,
    "volume": 781915.0
  },
  {
    "Unnamed: 0.1": 1745,
    "Unnamed: 0": 2129,
    "time": 1685128800,
    "open": 196.48,
    "high": 196.53,
    "low": 195.82,
    "close": 195.84,
    "volume": 1220426.0
  },
  {
    "Unnamed: 0.1": 1746,
    "Unnamed: 0": 2130,
    "time": 1685129100,
    "open": 195.84,
    "high": 195.84,
    "low": 194.64,
    "close": 195.02,
    "volume": 1838513.0
  },
  {
    "Unnamed: 0.1": 1747,
    "Unnamed: 0": 2131,
    "time": 1685129400,
    "open": 195.01,
    "high": 195.05,
    "low": 194.4,
    "close": 194.86,
    "volume": 1681213.0
  },
  {
    "Unnamed: 0.1": 1748,
    "Unnamed: 0": 2132,
    "time": 1685129700,
    "open": 194.84,
    "high": 194.95,
    "low": 193.25,
    "close": 193.53,
    "volume": 2091226.0
  },
  {
    "Unnamed: 0.1": 1749,
    "Unnamed: 0": 2133,
    "time": 1685130000,
    "open": 193.53,
    "high": 193.85,
    "low": 193.17,
    "close": 193.59,
    "volume": 1635088.0
  },
  {
    "Unnamed: 0.1": 1750,
    "Unnamed: 0": 2134,
    "time": 1685130300,
    "open": 193.57,
    "high": 193.58,
    "low": 192.25,
    "close": 192.61,
    "volume": 2301804.0
  },
  {
    "Unnamed: 0.1": 1751,
    "Unnamed: 0": 2135,
    "time": 1685130600,
    "open": 192.58,
    "high": 193.11,
    "low": 191.89,
    "close": 193.1,
    "volume": 2354994.0
  },
  {
    "Unnamed: 0.1": 1752,
    "Unnamed: 0": 2136,
    "time": 1685130900,
    "open": 193.09,
    "high": 193.48,
    "low": 193.07,
    "close": 193.16,
    "volume": 2261910.0
  },
  {
    "Unnamed: 0.1": 1753,
    "Unnamed: 0": 2137,
    "time": 1685131200,
    "open": 193.15,
    "high": 193.29,
    "low": 192.82,
    "close": 192.92,
    "volume": 2580871.0
  },
  {
    "Unnamed: 0.1": 1754,
    "Unnamed: 0": 2138,
    "time": 1685131500,
    "open": 193.0,
    "high": 193.17,
    "low": 192.95,
    "close": 193.06,
    "volume": 104363.0
  },
  {
    "Unnamed: 0.1": 1755,
    "Unnamed: 0": 2139,
    "time": 1685131800,
    "open": 193.06,
    "high": 193.3,
    "low": 193.06,
    "close": 193.24,
    "volume": 44045.0
  },
  {
    "Unnamed: 0.1": 1756,
    "Unnamed: 0": 2140,
    "time": 1685132100,
    "open": 193.28,
    "high": 193.29,
    "low": 193.17,
    "close": 193.25,
    "volume": 19153.0
  },
  {
    "Unnamed: 0.1": 1757,
    "Unnamed: 0": 2141,
    "time": 1685132400,
    "open": 193.25,
    "high": 193.35,
    "low": 193.2,
    "close": 193.33,
    "volume": 24898.0
  },
  {
    "Unnamed: 0.1": 1758,
    "Unnamed: 0": 2142,
    "time": 1685132700,
    "open": 193.31,
    "high": 193.32,
    "low": 193.2,
    "close": 193.26,
    "volume": 19782.0
  },
  {
    "Unnamed: 0.1": 1759,
    "Unnamed: 0": 2143,
    "time": 1685133000,
    "open": 193.3,
    "high": 193.39,
    "low": 193.3,
    "close": 193.32,
    "volume": 27455.0
  },
  {
    "Unnamed: 0.1": 1760,
    "Unnamed: 0": 2144,
    "time": 1685133300,
    "open": 193.32,
    "high": 193.88,
    "low": 193.3,
    "close": 193.88,
    "volume": 43506.0
  },
  {
    "Unnamed: 0.1": 1761,
    "Unnamed: 0": 2145,
    "time": 1685133600,
    "open": 193.72,
    "high": 193.82,
    "low": 193.57,
    "close": 193.64,
    "volume": 25726.0
  },
  {
    "Unnamed: 0.1": 1762,
    "Unnamed: 0": 2146,
    "time": 1685133900,
    "open": 193.55,
    "high": 193.7,
    "low": 193.55,
    "close": 193.68,
    "volume": 14651.0
  },
  {
    "Unnamed: 0.1": 1763,
    "Unnamed: 0": 2147,
    "time": 1685134200,
    "open": 193.65,
    "high": 193.85,
    "low": 193.65,
    "close": 193.85,
    "volume": 16925.0
  },
  {
    "Unnamed: 0.1": 1764,
    "Unnamed: 0": 2148,
    "time": 1685134500,
    "open": 193.84,
    "high": 194.1,
    "low": 193.17,
    "close": 194.06,
    "volume": 37783.0
  },
  {
    "Unnamed: 0.1": 1765,
    "Unnamed: 0": 2149,
    "time": 1685134800,
    "open": 194.07,
    "high": 194.47,
    "low": 194.0,
    "close": 194.38,
    "volume": 47049.0
  },
  {
    "Unnamed: 0.1": 1766,
    "Unnamed: 0": 2150,
    "time": 1685135100,
    "open": 194.4,
    "high": 194.44,
    "low": 193.84,
    "close": 193.84,
    "volume": 59432.0
  },
  {
    "Unnamed: 0.1": 1767,
    "Unnamed: 0": 2151,
    "time": 1685135400,
    "open": 193.85,
    "high": 194.17,
    "low": 193.85,
    "close": 194.05,
    "volume": 19660.0
  },
  {
    "Unnamed: 0.1": 1768,
    "Unnamed: 0": 2152,
    "time": 1685135700,
    "open": 194.08,
    "high": 194.09,
    "low": 193.86,
    "close": 193.98,
    "volume": 26867.0
  },
  {
    "Unnamed: 0.1": 1769,
    "Unnamed: 0": 2153,
    "time": 1685136000,
    "open": 193.9,
    "high": 194.0,
    "low": 193.9,
    "close": 194.0,
    "volume": 10128.0
  },
  {
    "Unnamed: 0.1": 1770,
    "Unnamed: 0": 2154,
    "time": 1685136300,
    "open": 194.02,
    "high": 194.15,
    "low": 194.0,
    "close": 194.0,
    "volume": 16376.0
  },
  {
    "Unnamed: 0.1": 1771,
    "Unnamed: 0": 2155,
    "time": 1685136600,
    "open": 193.97,
    "high": 194.15,
    "low": 193.95,
    "close": 194.13,
    "volume": 14854.0
  },
  {
    "Unnamed: 0.1": 1772,
    "Unnamed: 0": 2156,
    "time": 1685136900,
    "open": 194.15,
    "high": 194.15,
    "low": 193.98,
    "close": 193.98,
    "volume": 15762.0
  },
  {
    "Unnamed: 0.1": 1773,
    "Unnamed: 0": 2157,
    "time": 1685137200,
    "open": 194.0,
    "high": 194.3,
    "low": 193.95,
    "close": 194.2,
    "volume": 30938.0
  },
  {
    "Unnamed: 0.1": 1774,
    "Unnamed: 0": 2158,
    "time": 1685137500,
    "open": 194.22,
    "high": 194.37,
    "low": 194.04,
    "close": 194.06,
    "volume": 21215.0
  },
  {
    "Unnamed: 0.1": 1775,
    "Unnamed: 0": 2159,
    "time": 1685137800,
    "open": 194.14,
    "high": 194.15,
    "low": 193.97,
    "close": 193.97,
    "volume": 13265.0
  },
  {
    "Unnamed: 0.1": 1776,
    "Unnamed: 0": 2160,
    "time": 1685138100,
    "open": 193.94,
    "high": 193.99,
    "low": 193.92,
    "close": 193.98,
    "volume": 9442.0
  },
  {
    "Unnamed: 0.1": 1777,
    "Unnamed: 0": 2161,
    "time": 1685138400,
    "open": 194.0,
    "high": 194.05,
    "low": 193.98,
    "close": 194.05,
    "volume": 12102.0
  },
  {
    "Unnamed: 0.1": 1778,
    "Unnamed: 0": 2162,
    "time": 1685138700,
    "open": 194.02,
    "high": 194.04,
    "low": 193.94,
    "close": 194.0,
    "volume": 12518.0
  },
  {
    "Unnamed: 0.1": 1779,
    "Unnamed: 0": 2163,
    "time": 1685139000,
    "open": 194.0,
    "high": 194.04,
    "low": 193.96,
    "close": 194.0,
    "volume": 21094.0
  },
  {
    "Unnamed: 0.1": 1780,
    "Unnamed: 0": 2164,
    "time": 1685139300,
    "open": 194.0,
    "high": 194.03,
    "low": 193.94,
    "close": 193.96,
    "volume": 10008.0
  },
  {
    "Unnamed: 0.1": 1781,
    "Unnamed: 0": 2165,
    "time": 1685139600,
    "open": 193.95,
    "high": 193.97,
    "low": 193.95,
    "close": 193.95,
    "volume": 7385.0
  },
  {
    "Unnamed: 0.1": 1782,
    "Unnamed: 0": 2166,
    "time": 1685139900,
    "open": 193.95,
    "high": 193.96,
    "low": 193.94,
    "close": 193.96,
    "volume": 7152.0
  },
  {
    "Unnamed: 0.1": 1783,
    "Unnamed: 0": 2167,
    "time": 1685140200,
    "open": 193.96,
    "high": 193.96,
    "low": 193.83,
    "close": 193.83,
    "volume": 7736.0
  },
  {
    "Unnamed: 0.1": 1784,
    "Unnamed: 0": 2168,
    "time": 1685140500,
    "open": 193.83,
    "high": 193.87,
    "low": 193.67,
    "close": 193.83,
    "volume": 13150.0
  },
  {
    "Unnamed: 0.1": 1785,
    "Unnamed: 0": 2169,
    "time": 1685140800,
    "open": 193.83,
    "high": 193.86,
    "low": 193.65,
    "close": 193.78,
    "volume": 15393.0
  },
  {
    "Unnamed: 0.1": 1786,
    "Unnamed: 0": 2170,
    "time": 1685141100,
    "open": 193.7,
    "high": 193.79,
    "low": 193.7,
    "close": 193.73,
    "volume": 8134.0
  },
  {
    "Unnamed: 0.1": 1787,
    "Unnamed: 0": 2171,
    "time": 1685141400,
    "open": 193.73,
    "high": 193.77,
    "low": 193.7,
    "close": 193.74,
    "volume": 2680.0
  },
  {
    "Unnamed: 0.1": 1788,
    "Unnamed: 0": 2172,
    "time": 1685141700,
    "open": 193.74,
    "high": 193.85,
    "low": 193.74,
    "close": 193.82,
    "volume": 9564.0
  },
  {
    "Unnamed: 0.1": 1789,
    "Unnamed: 0": 2173,
    "time": 1685142000,
    "open": 193.83,
    "high": 193.85,
    "low": 193.71,
    "close": 193.72,
    "volume": 6062.0
  },
  {
    "Unnamed: 0.1": 1790,
    "Unnamed: 0": 2174,
    "time": 1685142300,
    "open": 193.74,
    "high": 193.85,
    "low": 193.74,
    "close": 193.83,
    "volume": 6838.0
  },
  {
    "Unnamed: 0.1": 1791,
    "Unnamed: 0": 2175,
    "time": 1685142600,
    "open": 193.77,
    "high": 193.89,
    "low": 193.77,
    "close": 193.85,
    "volume": 9828.0
  },
  {
    "Unnamed: 0.1": 1792,
    "Unnamed: 0": 2176,
    "time": 1685142900,
    "open": 193.8,
    "high": 193.81,
    "low": 193.73,
    "close": 193.76,
    "volume": 3388.0
  },
  {
    "Unnamed: 0.1": 1793,
    "Unnamed: 0": 2177,
    "time": 1685143200,
    "open": 193.72,
    "high": 193.79,
    "low": 193.72,
    "close": 193.79,
    "volume": 4008.0
  },
  {
    "Unnamed: 0.1": 1794,
    "Unnamed: 0": 2178,
    "time": 1685143500,
    "open": 193.72,
    "high": 193.78,
    "low": 193.7,
    "close": 193.7,
    "volume": 6933.0
  },
  {
    "Unnamed: 0.1": 1795,
    "Unnamed: 0": 2179,
    "time": 1685143800,
    "open": 193.71,
    "high": 193.84,
    "low": 193.55,
    "close": 193.65,
    "volume": 9716.0
  },
  {
    "Unnamed: 0.1": 1796,
    "Unnamed: 0": 2180,
    "time": 1685144100,
    "open": 193.65,
    "high": 193.7,
    "low": 193.58,
    "close": 193.68,
    "volume": 10243.0
  },
  {
    "Unnamed: 0.1": 1797,
    "Unnamed: 0": 2181,
    "time": 1685144400,
    "open": 193.7,
    "high": 193.87,
    "low": 193.65,
    "close": 193.85,
    "volume": 15379.0
  },
  {
    "Unnamed: 0.1": 1798,
    "Unnamed: 0": 2182,
    "time": 1685144700,
    "open": 193.85,
    "high": 193.87,
    "low": 193.8,
    "close": 193.82,
    "volume": 10666.0
  },
  {
    "Unnamed: 0.1": 1799,
    "Unnamed: 0": 2183,
    "time": 1685145000,
    "open": 193.84,
    "high": 194.0,
    "low": 193.82,
    "close": 193.98,
    "volume": 21861.0
  },
  {
    "Unnamed: 0.1": 1800,
    "Unnamed: 0": 2184,
    "time": 1685145300,
    "open": 194.0,
    "high": 194.11,
    "low": 193.9,
    "close": 194.0,
    "volume": 37319.0
  }
])
window.ltoukohz.volumeSeries.setData([
  {
    "Unnamed: 0.1": 0,
    "Unnamed: 0": 0,
    "time": 1683792000,
    "value": 12398.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1,
    "Unnamed: 0": 1,
    "time": 1683792300,
    "value": 4999.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 2,
    "Unnamed: 0": 2,
    "time": 1683792600,
    "value": 2460.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 3,
    "Unnamed: 0": 3,
    "time": 1683792900,
    "value": 3048.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 4,
    "Unnamed: 0": 4,
    "time": 1683793200,
    "value": 4469.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 5,
    "Unnamed: 0": 5,
    "time": 1683793500,
    "value": 7908.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 6,
    "Unnamed: 0": 6,
    "time": 1683793800,
    "value": 2864.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 7,
    "Unnamed: 0": 7,
    "time": 1683794100,
    "value": 2072.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 8,
    "Unnamed: 0": 8,
    "time": 1683794400,
    "value": 745.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 9,
    "Unnamed: 0": 9,
    "time": 1683794700,
    "value": 715.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 10,
    "Unnamed: 0": 10,
    "time": 1683795000,
    "value": 229.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 11,
    "Unnamed: 0": 11,
    "time": 1683795300,
    "value": 1202.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 12,
    "Unnamed: 0": 12,
    "time": 1683795600,
    "value": 3250.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 13,
    "Unnamed: 0": 13,
    "time": 1683795900,
    "value": 835.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 14,
    "Unnamed: 0": 14,
    "time": 1683796200,
    "value": 1041.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 15,
    "Unnamed: 0": 15,
    "time": 1683796500,
    "value": 492.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 16,
    "Unnamed: 0": 16,
    "time": 1683796800,
    "value": 5289.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 17,
    "Unnamed: 0": 17,
    "time": 1683797100,
    "value": 3344.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 18,
    "Unnamed: 0": 18,
    "time": 1683797400,
    "value": 3447.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 19,
    "Unnamed: 0": 19,
    "time": 1683797700,
    "value": 5992.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 20,
    "Unnamed: 0": 20,
    "time": 1683798000,
    "value": 1306.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 21,
    "Unnamed: 0": 21,
    "time": 1683798300,
    "value": 643.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 22,
    "Unnamed: 0": 22,
    "time": 1683798600,
    "value": 2865.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 23,
    "Unnamed: 0": 23,
    "time": 1683798900,
    "value": 2125.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 24,
    "Unnamed: 0": 24,
    "time": 1683799200,
    "value": 2156.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 25,
    "Unnamed: 0": 25,
    "time": 1683799500,
    "value": 300.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 26,
    "Unnamed: 0": 26,
    "time": 1683799800,
    "value": 3253.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 27,
    "Unnamed: 0": 27,
    "time": 1683800100,
    "value": 1464.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 28,
    "Unnamed: 0": 28,
    "time": 1683800400,
    "value": 200.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 29,
    "Unnamed: 0": 29,
    "time": 1683800700,
    "value": 1000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 30,
    "Unnamed: 0": 30,
    "time": 1683801000,
    "value": 576.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 31,
    "Unnamed: 0": 31,
    "time": 1683801300,
    "value": 2330.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 32,
    "Unnamed: 0": 32,
    "time": 1683801600,
    "value": 693.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 33,
    "Unnamed: 0": 33,
    "time": 1683801900,
    "value": 713.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 34,
    "Unnamed: 0": 34,
    "time": 1683802200,
    "value": 100.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 35,
    "Unnamed: 0": 35,
    "time": 1683802500,
    "value": 4163.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 36,
    "Unnamed: 0": 36,
    "time": 1683802800,
    "value": 29864.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 37,
    "Unnamed: 0": 37,
    "time": 1683803100,
    "value": 13183.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 38,
    "Unnamed: 0": 38,
    "time": 1683803400,
    "value": 17187.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 39,
    "Unnamed: 0": 39,
    "time": 1683803700,
    "value": 11387.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 40,
    "Unnamed: 0": 40,
    "time": 1683804000,
    "value": 12165.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 41,
    "Unnamed: 0": 41,
    "time": 1683804300,
    "value": 11409.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 42,
    "Unnamed: 0": 42,
    "time": 1683804600,
    "value": 4265.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 43,
    "Unnamed: 0": 43,
    "time": 1683804900,
    "value": 2826.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 44,
    "Unnamed: 0": 44,
    "time": 1683805200,
    "value": 19258.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 45,
    "Unnamed: 0": 45,
    "time": 1683805500,
    "value": 6722.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 46,
    "Unnamed: 0": 46,
    "time": 1683805800,
    "value": 1517.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 47,
    "Unnamed: 0": 47,
    "time": 1683806100,
    "value": 4212.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 48,
    "Unnamed: 0": 48,
    "time": 1683806400,
    "value": 124679.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 49,
    "Unnamed: 0": 49,
    "time": 1683806700,
    "value": 18155.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 50,
    "Unnamed: 0": 50,
    "time": 1683807000,
    "value": 21809.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 51,
    "Unnamed: 0": 51,
    "time": 1683807300,
    "value": 27310.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 52,
    "Unnamed: 0": 52,
    "time": 1683807600,
    "value": 18917.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 53,
    "Unnamed: 0": 53,
    "time": 1683807900,
    "value": 30471.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 54,
    "Unnamed: 0": 54,
    "time": 1683808200,
    "value": 87415.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 55,
    "Unnamed: 0": 55,
    "time": 1683808500,
    "value": 66402.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 56,
    "Unnamed: 0": 56,
    "time": 1683808800,
    "value": 29101.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 57,
    "Unnamed: 0": 57,
    "time": 1683809100,
    "value": 33949.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 58,
    "Unnamed: 0": 58,
    "time": 1683809400,
    "value": 32036.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 59,
    "Unnamed: 0": 59,
    "time": 1683809700,
    "value": 47495.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 60,
    "Unnamed: 0": 60,
    "time": 1683810000,
    "value": 56564.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 61,
    "Unnamed: 0": 61,
    "time": 1683810300,
    "value": 33184.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 62,
    "Unnamed: 0": 62,
    "time": 1683810600,
    "value": 41535.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 63,
    "Unnamed: 0": 63,
    "time": 1683810900,
    "value": 10504.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 64,
    "Unnamed: 0": 64,
    "time": 1683811200,
    "value": 34073.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 65,
    "Unnamed: 0": 65,
    "time": 1683811500,
    "value": 44916.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 66,
    "Unnamed: 0": 66,
    "time": 1683811800,
    "value": 2417972.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 67,
    "Unnamed: 0": 67,
    "time": 1683812100,
    "value": 2412109.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 68,
    "Unnamed: 0": 68,
    "time": 1683812400,
    "value": 1651438.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 69,
    "Unnamed: 0": 69,
    "time": 1683812700,
    "value": 2055091.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 70,
    "Unnamed: 0": 70,
    "time": 1683813000,
    "value": 1656786.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 71,
    "Unnamed: 0": 71,
    "time": 1683813300,
    "value": 1474799.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 72,
    "Unnamed: 0": 72,
    "time": 1683813600,
    "value": 1828611.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 73,
    "Unnamed: 0": 73,
    "time": 1683813900,
    "value": 1210247.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 74,
    "Unnamed: 0": 74,
    "time": 1683814200,
    "value": 1733818.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 75,
    "Unnamed: 0": 75,
    "time": 1683814500,
    "value": 1829549.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 76,
    "Unnamed: 0": 76,
    "time": 1683814800,
    "value": 1563771.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 77,
    "Unnamed: 0": 77,
    "time": 1683815100,
    "value": 1159607.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 78,
    "Unnamed: 0": 78,
    "time": 1683815400,
    "value": 1499795.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 79,
    "Unnamed: 0": 79,
    "time": 1683815700,
    "value": 1072593.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 80,
    "Unnamed: 0": 80,
    "time": 1683816000,
    "value": 1472952.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 81,
    "Unnamed: 0": 81,
    "time": 1683816300,
    "value": 1381580.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 82,
    "Unnamed: 0": 82,
    "time": 1683816600,
    "value": 1273087.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 83,
    "Unnamed: 0": 83,
    "time": 1683816900,
    "value": 989453.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 84,
    "Unnamed: 0": 84,
    "time": 1683817200,
    "value": 1002333.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 85,
    "Unnamed: 0": 85,
    "time": 1683817500,
    "value": 845510.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 86,
    "Unnamed: 0": 86,
    "time": 1683817800,
    "value": 947543.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 87,
    "Unnamed: 0": 87,
    "time": 1683818100,
    "value": 721736.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 88,
    "Unnamed: 0": 88,
    "time": 1683818400,
    "value": 898776.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 89,
    "Unnamed: 0": 89,
    "time": 1683818700,
    "value": 1016725.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 90,
    "Unnamed: 0": 90,
    "time": 1683819000,
    "value": 860208.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 91,
    "Unnamed: 0": 91,
    "time": 1683819300,
    "value": 659070.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 92,
    "Unnamed: 0": 92,
    "time": 1683819600,
    "value": 857193.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 93,
    "Unnamed: 0": 93,
    "time": 1683819900,
    "value": 918307.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 94,
    "Unnamed: 0": 94,
    "time": 1683820200,
    "value": 692229.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 95,
    "Unnamed: 0": 95,
    "time": 1683820500,
    "value": 977608.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 96,
    "Unnamed: 0": 96,
    "time": 1683820800,
    "value": 927505.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 97,
    "Unnamed: 0": 97,
    "time": 1683821100,
    "value": 874230.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 98,
    "Unnamed: 0": 98,
    "time": 1683821400,
    "value": 773267.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 99,
    "Unnamed: 0": 99,
    "time": 1683821700,
    "value": 686133.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 100,
    "Unnamed: 0": 100,
    "time": 1683822000,
    "value": 586308.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 101,
    "Unnamed: 0": 101,
    "time": 1683822300,
    "value": 843922.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 102,
    "Unnamed: 0": 102,
    "time": 1683822600,
    "value": 569617.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 103,
    "Unnamed: 0": 103,
    "time": 1683822900,
    "value": 752002.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 104,
    "Unnamed: 0": 104,
    "time": 1683823200,
    "value": 712948.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 105,
    "Unnamed: 0": 105,
    "time": 1683823500,
    "value": 601669.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 106,
    "Unnamed: 0": 106,
    "time": 1683823800,
    "value": 568796.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 107,
    "Unnamed: 0": 107,
    "time": 1683824100,
    "value": 508243.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 108,
    "Unnamed: 0": 108,
    "time": 1683824400,
    "value": 608985.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 109,
    "Unnamed: 0": 109,
    "time": 1683824700,
    "value": 766287.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 110,
    "Unnamed: 0": 110,
    "time": 1683825000,
    "value": 553446.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 111,
    "Unnamed: 0": 111,
    "time": 1683825300,
    "value": 572971.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 112,
    "Unnamed: 0": 112,
    "time": 1683825600,
    "value": 628066.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 113,
    "Unnamed: 0": 113,
    "time": 1683825900,
    "value": 527008.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 114,
    "Unnamed: 0": 114,
    "time": 1683826200,
    "value": 761740.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 115,
    "Unnamed: 0": 115,
    "time": 1683826500,
    "value": 647667.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 116,
    "Unnamed: 0": 116,
    "time": 1683826800,
    "value": 484676.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 117,
    "Unnamed: 0": 117,
    "time": 1683827100,
    "value": 795097.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 118,
    "Unnamed: 0": 118,
    "time": 1683827400,
    "value": 608889.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 119,
    "Unnamed: 0": 119,
    "time": 1683827700,
    "value": 599885.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 120,
    "Unnamed: 0": 120,
    "time": 1683828000,
    "value": 438144.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 121,
    "Unnamed: 0": 121,
    "time": 1683828300,
    "value": 447621.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 122,
    "Unnamed: 0": 122,
    "time": 1683828600,
    "value": 442499.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 123,
    "Unnamed: 0": 123,
    "time": 1683828900,
    "value": 514363.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 124,
    "Unnamed: 0": 124,
    "time": 1683829200,
    "value": 477430.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 125,
    "Unnamed: 0": 125,
    "time": 1683829500,
    "value": 491107.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 126,
    "Unnamed: 0": 126,
    "time": 1683829800,
    "value": 505286.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 127,
    "Unnamed: 0": 127,
    "time": 1683830100,
    "value": 731400.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 128,
    "Unnamed: 0": 128,
    "time": 1683830400,
    "value": 1070893.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 129,
    "Unnamed: 0": 129,
    "time": 1683830700,
    "value": 847870.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 130,
    "Unnamed: 0": 130,
    "time": 1683831000,
    "value": 698704.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 131,
    "Unnamed: 0": 131,
    "time": 1683831300,
    "value": 619545.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 132,
    "Unnamed: 0": 132,
    "time": 1683831600,
    "value": 711468.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 133,
    "Unnamed: 0": 133,
    "time": 1683831900,
    "value": 1121705.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 134,
    "Unnamed: 0": 134,
    "time": 1683832200,
    "value": 907470.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 135,
    "Unnamed: 0": 135,
    "time": 1683832500,
    "value": 608436.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 136,
    "Unnamed: 0": 136,
    "time": 1683832800,
    "value": 660460.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 137,
    "Unnamed: 0": 137,
    "time": 1683833100,
    "value": 585839.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 138,
    "Unnamed: 0": 138,
    "time": 1683833400,
    "value": 727056.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 139,
    "Unnamed: 0": 139,
    "time": 1683833700,
    "value": 653203.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 140,
    "Unnamed: 0": 140,
    "time": 1683834000,
    "value": 1917575.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 141,
    "Unnamed: 0": 141,
    "time": 1683834300,
    "value": 5150185.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 142,
    "Unnamed: 0": 142,
    "time": 1683834600,
    "value": 2744123.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 143,
    "Unnamed: 0": 143,
    "time": 1683834900,
    "value": 2992652.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 144,
    "Unnamed: 0": 144,
    "time": 1683835200,
    "value": 1839928.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 145,
    "Unnamed: 0": 145,
    "time": 1683835500,
    "value": 272329.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 146,
    "Unnamed: 0": 146,
    "time": 1683835800,
    "value": 233282.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 147,
    "Unnamed: 0": 147,
    "time": 1683836100,
    "value": 135334.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 148,
    "Unnamed: 0": 148,
    "time": 1683836400,
    "value": 167268.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 149,
    "Unnamed: 0": 149,
    "time": 1683836700,
    "value": 177769.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 150,
    "Unnamed: 0": 150,
    "time": 1683837000,
    "value": 117334.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 151,
    "Unnamed: 0": 151,
    "time": 1683837300,
    "value": 70470.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 152,
    "Unnamed: 0": 152,
    "time": 1683837600,
    "value": 125591.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 153,
    "Unnamed: 0": 153,
    "time": 1683837900,
    "value": 96586.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 154,
    "Unnamed: 0": 154,
    "time": 1683838200,
    "value": 77595.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 155,
    "Unnamed: 0": 155,
    "time": 1683838500,
    "value": 44227.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 156,
    "Unnamed: 0": 156,
    "time": 1683838800,
    "value": 44534.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 157,
    "Unnamed: 0": 157,
    "time": 1683839100,
    "value": 99984.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 158,
    "Unnamed: 0": 158,
    "time": 1683839400,
    "value": 58043.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 159,
    "Unnamed: 0": 159,
    "time": 1683839700,
    "value": 73369.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 160,
    "Unnamed: 0": 160,
    "time": 1683840000,
    "value": 33389.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 161,
    "Unnamed: 0": 161,
    "time": 1683840300,
    "value": 42570.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 162,
    "Unnamed: 0": 162,
    "time": 1683840600,
    "value": 39015.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 163,
    "Unnamed: 0": 163,
    "time": 1683840900,
    "value": 26384.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 164,
    "Unnamed: 0": 164,
    "time": 1683841200,
    "value": 36763.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 165,
    "Unnamed: 0": 165,
    "time": 1683841500,
    "value": 16807.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 166,
    "Unnamed: 0": 166,
    "time": 1683841800,
    "value": 16052.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 167,
    "Unnamed: 0": 167,
    "time": 1683842100,
    "value": 11854.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 168,
    "Unnamed: 0": 168,
    "time": 1683842400,
    "value": 14261.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 169,
    "Unnamed: 0": 169,
    "time": 1683842700,
    "value": 42028.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 170,
    "Unnamed: 0": 170,
    "time": 1683843000,
    "value": 19715.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 171,
    "Unnamed: 0": 171,
    "time": 1683843300,
    "value": 11715.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 172,
    "Unnamed: 0": 172,
    "time": 1683843600,
    "value": 15128.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 173,
    "Unnamed: 0": 173,
    "time": 1683843900,
    "value": 16926.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 174,
    "Unnamed: 0": 174,
    "time": 1683844200,
    "value": 19623.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 175,
    "Unnamed: 0": 175,
    "time": 1683844500,
    "value": 15263.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 176,
    "Unnamed: 0": 176,
    "time": 1683844800,
    "value": 21271.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 177,
    "Unnamed: 0": 177,
    "time": 1683845100,
    "value": 69317.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 178,
    "Unnamed: 0": 178,
    "time": 1683845400,
    "value": 35236.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 179,
    "Unnamed: 0": 179,
    "time": 1683845700,
    "value": 44118.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 180,
    "Unnamed: 0": 180,
    "time": 1683846000,
    "value": 117705.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 181,
    "Unnamed: 0": 181,
    "time": 1683846300,
    "value": 87048.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 182,
    "Unnamed: 0": 182,
    "time": 1683846600,
    "value": 67293.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 183,
    "Unnamed: 0": 183,
    "time": 1683846900,
    "value": 51391.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 184,
    "Unnamed: 0": 184,
    "time": 1683847200,
    "value": 71590.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 185,
    "Unnamed: 0": 185,
    "time": 1683847500,
    "value": 46928.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 186,
    "Unnamed: 0": 186,
    "time": 1683847800,
    "value": 50255.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 187,
    "Unnamed: 0": 187,
    "time": 1683848100,
    "value": 98644.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 188,
    "Unnamed: 0": 188,
    "time": 1683848400,
    "value": 75437.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 189,
    "Unnamed: 0": 189,
    "time": 1683848700,
    "value": 51910.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 190,
    "Unnamed: 0": 190,
    "time": 1683849000,
    "value": 59984.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 191,
    "Unnamed: 0": 191,
    "time": 1683849300,
    "value": 90335.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 192,
    "Unnamed: 0": 192,
    "time": 1683878400,
    "value": 25600.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 193,
    "Unnamed: 0": 193,
    "time": 1683878700,
    "value": 7795.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 194,
    "Unnamed: 0": 194,
    "time": 1683879000,
    "value": 9569.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 195,
    "Unnamed: 0": 195,
    "time": 1683879300,
    "value": 3106.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 196,
    "Unnamed: 0": 196,
    "time": 1683879600,
    "value": 3177.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 197,
    "Unnamed: 0": 197,
    "time": 1683879900,
    "value": 5877.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 198,
    "Unnamed: 0": 198,
    "time": 1683880200,
    "value": 7369.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 199,
    "Unnamed: 0": 199,
    "time": 1683880500,
    "value": 3375.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 200,
    "Unnamed: 0": 200,
    "time": 1683880800,
    "value": 5881.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 201,
    "Unnamed: 0": 201,
    "time": 1683881100,
    "value": 250.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 202,
    "Unnamed: 0": 202,
    "time": 1683881400,
    "value": 450.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 203,
    "Unnamed: 0": 203,
    "time": 1683881700,
    "value": 2453.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 204,
    "Unnamed: 0": 204,
    "time": 1683882000,
    "value": 3817.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 205,
    "Unnamed: 0": 205,
    "time": 1683882300,
    "value": 7592.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 206,
    "Unnamed: 0": 206,
    "time": 1683882600,
    "value": 9342.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 207,
    "Unnamed: 0": 207,
    "time": 1683882900,
    "value": 2729.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 208,
    "Unnamed: 0": 208,
    "time": 1683883200,
    "value": 850.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 209,
    "Unnamed: 0": 209,
    "time": 1683883500,
    "value": 2885.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 210,
    "Unnamed: 0": 210,
    "time": 1683883800,
    "value": 8667.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 211,
    "Unnamed: 0": 211,
    "time": 1683884100,
    "value": 9349.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 212,
    "Unnamed: 0": 212,
    "time": 1683884400,
    "value": 4503.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 213,
    "Unnamed: 0": 213,
    "time": 1683884700,
    "value": 2232.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 214,
    "Unnamed: 0": 214,
    "time": 1683885000,
    "value": 1306.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 215,
    "Unnamed: 0": 215,
    "time": 1683885300,
    "value": 15389.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 216,
    "Unnamed: 0": 216,
    "time": 1683885600,
    "value": 952.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 217,
    "Unnamed: 0": 217,
    "time": 1683885900,
    "value": 3402.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 218,
    "Unnamed: 0": 218,
    "time": 1683886200,
    "value": 3338.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 219,
    "Unnamed: 0": 219,
    "time": 1683886500,
    "value": 2683.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 220,
    "Unnamed: 0": 220,
    "time": 1683886800,
    "value": 10368.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 221,
    "Unnamed: 0": 221,
    "time": 1683887100,
    "value": 881.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 222,
    "Unnamed: 0": 222,
    "time": 1683887400,
    "value": 4918.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 223,
    "Unnamed: 0": 223,
    "time": 1683887700,
    "value": 2881.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 224,
    "Unnamed: 0": 224,
    "time": 1683888000,
    "value": 3699.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 225,
    "Unnamed: 0": 225,
    "time": 1683888300,
    "value": 6425.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 226,
    "Unnamed: 0": 226,
    "time": 1683888600,
    "value": 7545.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 227,
    "Unnamed: 0": 227,
    "time": 1683888900,
    "value": 14851.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 228,
    "Unnamed: 0": 228,
    "time": 1683889200,
    "value": 124101.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 229,
    "Unnamed: 0": 229,
    "time": 1683889500,
    "value": 90365.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 230,
    "Unnamed: 0": 230,
    "time": 1683889800,
    "value": 89280.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 231,
    "Unnamed: 0": 231,
    "time": 1683890100,
    "value": 131601.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 232,
    "Unnamed: 0": 232,
    "time": 1683890400,
    "value": 100515.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 233,
    "Unnamed: 0": 233,
    "time": 1683890700,
    "value": 84076.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 234,
    "Unnamed: 0": 234,
    "time": 1683891000,
    "value": 42385.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 235,
    "Unnamed: 0": 235,
    "time": 1683891300,
    "value": 16916.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 236,
    "Unnamed: 0": 236,
    "time": 1683891600,
    "value": 34655.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 237,
    "Unnamed: 0": 237,
    "time": 1683891900,
    "value": 37689.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 238,
    "Unnamed: 0": 238,
    "time": 1683892200,
    "value": 25276.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 239,
    "Unnamed: 0": 239,
    "time": 1683892500,
    "value": 51049.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 240,
    "Unnamed: 0": 240,
    "time": 1683892800,
    "value": 341838.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 241,
    "Unnamed: 0": 241,
    "time": 1683893100,
    "value": 74312.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 242,
    "Unnamed: 0": 242,
    "time": 1683893400,
    "value": 117943.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 243,
    "Unnamed: 0": 243,
    "time": 1683893700,
    "value": 93100.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 244,
    "Unnamed: 0": 244,
    "time": 1683894000,
    "value": 52855.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 245,
    "Unnamed: 0": 245,
    "time": 1683894300,
    "value": 78346.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 246,
    "Unnamed: 0": 246,
    "time": 1683894600,
    "value": 93311.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 247,
    "Unnamed: 0": 247,
    "time": 1683894900,
    "value": 56225.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 248,
    "Unnamed: 0": 248,
    "time": 1683895200,
    "value": 118222.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 249,
    "Unnamed: 0": 249,
    "time": 1683895500,
    "value": 113236.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 250,
    "Unnamed: 0": 250,
    "time": 1683895800,
    "value": 132576.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 251,
    "Unnamed: 0": 251,
    "time": 1683896100,
    "value": 128299.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 252,
    "Unnamed: 0": 252,
    "time": 1683896400,
    "value": 84120.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 253,
    "Unnamed: 0": 253,
    "time": 1683896700,
    "value": 53316.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 254,
    "Unnamed: 0": 254,
    "time": 1683897000,
    "value": 107272.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 255,
    "Unnamed: 0": 255,
    "time": 1683897300,
    "value": 68160.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 256,
    "Unnamed: 0": 256,
    "time": 1683897600,
    "value": 66388.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 257,
    "Unnamed: 0": 257,
    "time": 1683897900,
    "value": 159084.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 258,
    "Unnamed: 0": 258,
    "time": 1683898200,
    "value": 5421951.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 259,
    "Unnamed: 0": 259,
    "time": 1683898500,
    "value": 4610796.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 260,
    "Unnamed: 0": 260,
    "time": 1683898800,
    "value": 3592232.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 261,
    "Unnamed: 0": 261,
    "time": 1683899100,
    "value": 3112590.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 262,
    "Unnamed: 0": 262,
    "time": 1683899400,
    "value": 3407487.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 263,
    "Unnamed: 0": 263,
    "time": 1683899700,
    "value": 2444745.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 264,
    "Unnamed: 0": 264,
    "time": 1683900000,
    "value": 3894326.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 265,
    "Unnamed: 0": 265,
    "time": 1683900300,
    "value": 3415545.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 266,
    "Unnamed: 0": 266,
    "time": 1683900600,
    "value": 2664291.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 267,
    "Unnamed: 0": 267,
    "time": 1683900900,
    "value": 2411572.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 268,
    "Unnamed: 0": 268,
    "time": 1683901200,
    "value": 3018944.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 269,
    "Unnamed: 0": 269,
    "time": 1683901500,
    "value": 2499166.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 270,
    "Unnamed: 0": 270,
    "time": 1683901800,
    "value": 2583874.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 271,
    "Unnamed: 0": 271,
    "time": 1683902100,
    "value": 2257025.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 272,
    "Unnamed: 0": 272,
    "time": 1683902400,
    "value": 1406958.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 273,
    "Unnamed: 0": 273,
    "time": 1683902700,
    "value": 1664103.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 274,
    "Unnamed: 0": 274,
    "time": 1683903000,
    "value": 1647655.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 275,
    "Unnamed: 0": 275,
    "time": 1683903300,
    "value": 2196130.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 276,
    "Unnamed: 0": 276,
    "time": 1683903600,
    "value": 1799281.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 277,
    "Unnamed: 0": 277,
    "time": 1683903900,
    "value": 1469645.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 278,
    "Unnamed: 0": 278,
    "time": 1683904200,
    "value": 1518577.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 279,
    "Unnamed: 0": 279,
    "time": 1683904500,
    "value": 1778733.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 280,
    "Unnamed: 0": 280,
    "time": 1683904800,
    "value": 1606170.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 281,
    "Unnamed: 0": 281,
    "time": 1683905100,
    "value": 1909691.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 282,
    "Unnamed: 0": 282,
    "time": 1683905400,
    "value": 2384919.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 283,
    "Unnamed: 0": 283,
    "time": 1683905700,
    "value": 2696877.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 284,
    "Unnamed: 0": 284,
    "time": 1683906000,
    "value": 1440487.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 285,
    "Unnamed: 0": 285,
    "time": 1683906300,
    "value": 1154864.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 286,
    "Unnamed: 0": 286,
    "time": 1683906600,
    "value": 1230582.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 287,
    "Unnamed: 0": 287,
    "time": 1683906900,
    "value": 1573767.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 288,
    "Unnamed: 0": 288,
    "time": 1683907200,
    "value": 1560080.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 289,
    "Unnamed: 0": 289,
    "time": 1683907500,
    "value": 1360592.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 290,
    "Unnamed: 0": 290,
    "time": 1683907800,
    "value": 1807020.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 291,
    "Unnamed: 0": 291,
    "time": 1683908100,
    "value": 2169578.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 292,
    "Unnamed: 0": 292,
    "time": 1683908400,
    "value": 2106144.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 293,
    "Unnamed: 0": 293,
    "time": 1683908700,
    "value": 1306197.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 294,
    "Unnamed: 0": 294,
    "time": 1683909000,
    "value": 1547077.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 295,
    "Unnamed: 0": 295,
    "time": 1683909300,
    "value": 1430926.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 296,
    "Unnamed: 0": 296,
    "time": 1683909600,
    "value": 1189690.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 297,
    "Unnamed: 0": 297,
    "time": 1683909900,
    "value": 1552147.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 298,
    "Unnamed: 0": 298,
    "time": 1683910200,
    "value": 1385879.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 299,
    "Unnamed: 0": 299,
    "time": 1683910500,
    "value": 1089610.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 300,
    "Unnamed: 0": 300,
    "time": 1683910800,
    "value": 1060447.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 301,
    "Unnamed: 0": 301,
    "time": 1683911100,
    "value": 994965.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 302,
    "Unnamed: 0": 302,
    "time": 1683911400,
    "value": 1048343.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 303,
    "Unnamed: 0": 303,
    "time": 1683911700,
    "value": 834824.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 304,
    "Unnamed: 0": 304,
    "time": 1683912000,
    "value": 1330379.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 305,
    "Unnamed: 0": 305,
    "time": 1683912300,
    "value": 816795.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 306,
    "Unnamed: 0": 306,
    "time": 1683912600,
    "value": 976977.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 307,
    "Unnamed: 0": 307,
    "time": 1683912900,
    "value": 939837.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 308,
    "Unnamed: 0": 308,
    "time": 1683913200,
    "value": 776443.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 309,
    "Unnamed: 0": 309,
    "time": 1683913500,
    "value": 619985.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 310,
    "Unnamed: 0": 310,
    "time": 1683913800,
    "value": 702217.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 311,
    "Unnamed: 0": 311,
    "time": 1683914100,
    "value": 1059951.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 312,
    "Unnamed: 0": 312,
    "time": 1683914400,
    "value": 1066842.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 313,
    "Unnamed: 0": 313,
    "time": 1683914700,
    "value": 787063.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 314,
    "Unnamed: 0": 314,
    "time": 1683915000,
    "value": 853241.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 315,
    "Unnamed: 0": 315,
    "time": 1683915300,
    "value": 676123.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 316,
    "Unnamed: 0": 316,
    "time": 1683915600,
    "value": 767873.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 317,
    "Unnamed: 0": 317,
    "time": 1683915900,
    "value": 960966.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 318,
    "Unnamed: 0": 318,
    "time": 1683916200,
    "value": 1331390.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 319,
    "Unnamed: 0": 319,
    "time": 1683916500,
    "value": 799072.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 320,
    "Unnamed: 0": 320,
    "time": 1683916800,
    "value": 795175.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 321,
    "Unnamed: 0": 321,
    "time": 1683917100,
    "value": 564454.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 322,
    "Unnamed: 0": 322,
    "time": 1683917400,
    "value": 709286.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 323,
    "Unnamed: 0": 323,
    "time": 1683917700,
    "value": 714479.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 324,
    "Unnamed: 0": 324,
    "time": 1683918000,
    "value": 1034909.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 325,
    "Unnamed: 0": 325,
    "time": 1683918300,
    "value": 829686.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 326,
    "Unnamed: 0": 326,
    "time": 1683918600,
    "value": 1103565.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 327,
    "Unnamed: 0": 327,
    "time": 1683918900,
    "value": 806181.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 328,
    "Unnamed: 0": 328,
    "time": 1683919200,
    "value": 866578.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 329,
    "Unnamed: 0": 329,
    "time": 1683919500,
    "value": 1515698.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 330,
    "Unnamed: 0": 330,
    "time": 1683919800,
    "value": 1328396.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 331,
    "Unnamed: 0": 331,
    "time": 1683920100,
    "value": 1326113.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 332,
    "Unnamed: 0": 332,
    "time": 1683920400,
    "value": 2430461.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 333,
    "Unnamed: 0": 333,
    "time": 1683920700,
    "value": 1847422.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 334,
    "Unnamed: 0": 334,
    "time": 1683921000,
    "value": 1640076.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 335,
    "Unnamed: 0": 335,
    "time": 1683921300,
    "value": 1958117.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 336,
    "Unnamed: 0": 336,
    "time": 1683921600,
    "value": 1383628.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 337,
    "Unnamed: 0": 337,
    "time": 1683921900,
    "value": 68975.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 338,
    "Unnamed: 0": 338,
    "time": 1683922200,
    "value": 20330.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 339,
    "Unnamed: 0": 339,
    "time": 1683922500,
    "value": 9829.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 340,
    "Unnamed: 0": 340,
    "time": 1683922800,
    "value": 17203.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 341,
    "Unnamed: 0": 341,
    "time": 1683923100,
    "value": 22639.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 342,
    "Unnamed: 0": 342,
    "time": 1683923400,
    "value": 16745.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 343,
    "Unnamed: 0": 343,
    "time": 1683923700,
    "value": 21102.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 344,
    "Unnamed: 0": 344,
    "time": 1683924000,
    "value": 19338.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 345,
    "Unnamed: 0": 345,
    "time": 1683924300,
    "value": 5382.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 346,
    "Unnamed: 0": 346,
    "time": 1683924600,
    "value": 9621.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 347,
    "Unnamed: 0": 347,
    "time": 1683924900,
    "value": 6213.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 348,
    "Unnamed: 0": 348,
    "time": 1683925200,
    "value": 5201.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 349,
    "Unnamed: 0": 349,
    "time": 1683925500,
    "value": 7536.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 350,
    "Unnamed: 0": 350,
    "time": 1683925800,
    "value": 16129.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 351,
    "Unnamed: 0": 351,
    "time": 1683926100,
    "value": 10288.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 352,
    "Unnamed: 0": 352,
    "time": 1683926400,
    "value": 17094.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 353,
    "Unnamed: 0": 353,
    "time": 1683926700,
    "value": 7946.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 354,
    "Unnamed: 0": 354,
    "time": 1683927000,
    "value": 9722.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 355,
    "Unnamed: 0": 355,
    "time": 1683927300,
    "value": 9917.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 356,
    "Unnamed: 0": 356,
    "time": 1683927600,
    "value": 24950.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 357,
    "Unnamed: 0": 357,
    "time": 1683927900,
    "value": 46015.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 358,
    "Unnamed: 0": 358,
    "time": 1683928200,
    "value": 22577.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 359,
    "Unnamed: 0": 359,
    "time": 1683928500,
    "value": 14306.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 360,
    "Unnamed: 0": 360,
    "time": 1683928800,
    "value": 12570.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 361,
    "Unnamed: 0": 361,
    "time": 1683929100,
    "value": 7413.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 362,
    "Unnamed: 0": 362,
    "time": 1683929400,
    "value": 7011.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 363,
    "Unnamed: 0": 363,
    "time": 1683929700,
    "value": 5880.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 364,
    "Unnamed: 0": 364,
    "time": 1683930000,
    "value": 6222.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 365,
    "Unnamed: 0": 365,
    "time": 1683930300,
    "value": 5077.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 366,
    "Unnamed: 0": 366,
    "time": 1683930600,
    "value": 11625.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 367,
    "Unnamed: 0": 367,
    "time": 1683930900,
    "value": 2686.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 368,
    "Unnamed: 0": 368,
    "time": 1683931200,
    "value": 9398.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 369,
    "Unnamed: 0": 369,
    "time": 1683931500,
    "value": 5326.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 370,
    "Unnamed: 0": 370,
    "time": 1683931800,
    "value": 30682.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 371,
    "Unnamed: 0": 371,
    "time": 1683932100,
    "value": 6583.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 372,
    "Unnamed: 0": 372,
    "time": 1683932400,
    "value": 3241.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 373,
    "Unnamed: 0": 373,
    "time": 1683932700,
    "value": 2715.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 374,
    "Unnamed: 0": 374,
    "time": 1683933000,
    "value": 5091.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 375,
    "Unnamed: 0": 375,
    "time": 1683933300,
    "value": 4721.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 376,
    "Unnamed: 0": 376,
    "time": 1683933600,
    "value": 3462.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 377,
    "Unnamed: 0": 377,
    "time": 1683933900,
    "value": 8539.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 378,
    "Unnamed: 0": 378,
    "time": 1683934200,
    "value": 6115.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 379,
    "Unnamed: 0": 379,
    "time": 1683934500,
    "value": 4896.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 380,
    "Unnamed: 0": 380,
    "time": 1683934800,
    "value": 16217.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 381,
    "Unnamed: 0": 381,
    "time": 1683935100,
    "value": 12921.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 382,
    "Unnamed: 0": 382,
    "time": 1683935400,
    "value": 11331.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 383,
    "Unnamed: 0": 383,
    "time": 1683935700,
    "value": 26488.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 384,
    "Unnamed: 0": 576,
    "time": 1684137600,
    "value": 14894.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 385,
    "Unnamed: 0": 577,
    "time": 1684137900,
    "value": 19063.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 386,
    "Unnamed: 0": 578,
    "time": 1684138200,
    "value": 5042.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 387,
    "Unnamed: 0": 579,
    "time": 1684138500,
    "value": 8397.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 388,
    "Unnamed: 0": 580,
    "time": 1684138800,
    "value": 9994.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 389,
    "Unnamed: 0": 581,
    "time": 1684139100,
    "value": 2573.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 390,
    "Unnamed: 0": 582,
    "time": 1684139400,
    "value": 1102.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 391,
    "Unnamed: 0": 583,
    "time": 1684139700,
    "value": 1134.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 392,
    "Unnamed: 0": 584,
    "time": 1684140000,
    "value": 977.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 393,
    "Unnamed: 0": 585,
    "time": 1684140300,
    "value": 3290.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 394,
    "Unnamed: 0": 586,
    "time": 1684140600,
    "value": 4425.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 395,
    "Unnamed: 0": 587,
    "time": 1684140900,
    "value": 9217.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 396,
    "Unnamed: 0": 588,
    "time": 1684141200,
    "value": 5884.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 397,
    "Unnamed: 0": 589,
    "time": 1684141500,
    "value": 1532.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 398,
    "Unnamed: 0": 590,
    "time": 1684141800,
    "value": 686.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 399,
    "Unnamed: 0": 591,
    "time": 1684142100,
    "value": 822.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 400,
    "Unnamed: 0": 592,
    "time": 1684142400,
    "value": 1802.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 401,
    "Unnamed: 0": 593,
    "time": 1684142700,
    "value": 2865.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 402,
    "Unnamed: 0": 594,
    "time": 1684143000,
    "value": 4174.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 403,
    "Unnamed: 0": 595,
    "time": 1684143300,
    "value": 1744.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 404,
    "Unnamed: 0": 596,
    "time": 1684143600,
    "value": 2504.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 405,
    "Unnamed: 0": 597,
    "time": 1684143900,
    "value": 1020.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 406,
    "Unnamed: 0": 598,
    "time": 1684144200,
    "value": 1170.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 407,
    "Unnamed: 0": 599,
    "time": 1684144500,
    "value": 312.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 408,
    "Unnamed: 0": 600,
    "time": 1684144800,
    "value": 5916.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 409,
    "Unnamed: 0": 601,
    "time": 1684145100,
    "value": 12974.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 410,
    "Unnamed: 0": 602,
    "time": 1684145400,
    "value": 135.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 411,
    "Unnamed: 0": 603,
    "time": 1684145700,
    "value": 1893.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 412,
    "Unnamed: 0": 604,
    "time": 1684146000,
    "value": 1437.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 413,
    "Unnamed: 0": 605,
    "time": 1684146300,
    "value": 382.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 414,
    "Unnamed: 0": 606,
    "time": 1684146600,
    "value": 450.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 415,
    "Unnamed: 0": 607,
    "time": 1684146900,
    "value": 576.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 416,
    "Unnamed: 0": 608,
    "time": 1684147200,
    "value": 6994.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 417,
    "Unnamed: 0": 609,
    "time": 1684147500,
    "value": 1629.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 418,
    "Unnamed: 0": 610,
    "time": 1684147800,
    "value": 5380.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 419,
    "Unnamed: 0": 611,
    "time": 1684148100,
    "value": 5249.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 420,
    "Unnamed: 0": 612,
    "time": 1684148400,
    "value": 34742.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 421,
    "Unnamed: 0": 613,
    "time": 1684148700,
    "value": 26349.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 422,
    "Unnamed: 0": 614,
    "time": 1684149000,
    "value": 25617.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 423,
    "Unnamed: 0": 615,
    "time": 1684149300,
    "value": 26851.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 424,
    "Unnamed: 0": 616,
    "time": 1684149600,
    "value": 9000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 425,
    "Unnamed: 0": 617,
    "time": 1684149900,
    "value": 14136.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 426,
    "Unnamed: 0": 618,
    "time": 1684150200,
    "value": 19490.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 427,
    "Unnamed: 0": 619,
    "time": 1684150500,
    "value": 24792.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 428,
    "Unnamed: 0": 620,
    "time": 1684150800,
    "value": 4999.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 429,
    "Unnamed: 0": 621,
    "time": 1684151100,
    "value": 8122.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 430,
    "Unnamed: 0": 622,
    "time": 1684151400,
    "value": 4340.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 431,
    "Unnamed: 0": 623,
    "time": 1684151700,
    "value": 10300.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 432,
    "Unnamed: 0": 624,
    "time": 1684152000,
    "value": 199353.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 433,
    "Unnamed: 0": 625,
    "time": 1684152300,
    "value": 21413.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 434,
    "Unnamed: 0": 626,
    "time": 1684152600,
    "value": 18746.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 435,
    "Unnamed: 0": 627,
    "time": 1684152900,
    "value": 12110.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 436,
    "Unnamed: 0": 628,
    "time": 1684153200,
    "value": 16797.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 437,
    "Unnamed: 0": 629,
    "time": 1684153500,
    "value": 61951.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 438,
    "Unnamed: 0": 630,
    "time": 1684153800,
    "value": 41195.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 439,
    "Unnamed: 0": 631,
    "time": 1684154100,
    "value": 22889.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 440,
    "Unnamed: 0": 632,
    "time": 1684154400,
    "value": 15541.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 441,
    "Unnamed: 0": 633,
    "time": 1684154700,
    "value": 51130.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 442,
    "Unnamed: 0": 634,
    "time": 1684155000,
    "value": 50172.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 443,
    "Unnamed: 0": 635,
    "time": 1684155300,
    "value": 32985.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 444,
    "Unnamed: 0": 636,
    "time": 1684155600,
    "value": 36604.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 445,
    "Unnamed: 0": 637,
    "time": 1684155900,
    "value": 16898.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 446,
    "Unnamed: 0": 638,
    "time": 1684156200,
    "value": 54362.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 447,
    "Unnamed: 0": 639,
    "time": 1684156500,
    "value": 68398.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 448,
    "Unnamed: 0": 640,
    "time": 1684156800,
    "value": 26372.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 449,
    "Unnamed: 0": 641,
    "time": 1684157100,
    "value": 34958.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 450,
    "Unnamed: 0": 642,
    "time": 1684157400,
    "value": 3387606.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 451,
    "Unnamed: 0": 643,
    "time": 1684157700,
    "value": 2130684.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 452,
    "Unnamed: 0": 644,
    "time": 1684158000,
    "value": 2501179.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 453,
    "Unnamed: 0": 645,
    "time": 1684158300,
    "value": 1577449.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 454,
    "Unnamed: 0": 646,
    "time": 1684158600,
    "value": 2768244.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 455,
    "Unnamed: 0": 647,
    "time": 1684158900,
    "value": 3681801.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 456,
    "Unnamed: 0": 648,
    "time": 1684159200,
    "value": 2367084.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 457,
    "Unnamed: 0": 649,
    "time": 1684159500,
    "value": 2049596.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 458,
    "Unnamed: 0": 650,
    "time": 1684159800,
    "value": 1221905.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 459,
    "Unnamed: 0": 651,
    "time": 1684160100,
    "value": 1504563.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 460,
    "Unnamed: 0": 652,
    "time": 1684160400,
    "value": 1868444.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 461,
    "Unnamed: 0": 653,
    "time": 1684160700,
    "value": 949515.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 462,
    "Unnamed: 0": 654,
    "time": 1684161000,
    "value": 1427052.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 463,
    "Unnamed: 0": 655,
    "time": 1684161300,
    "value": 1019919.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 464,
    "Unnamed: 0": 656,
    "time": 1684161600,
    "value": 928466.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 465,
    "Unnamed: 0": 657,
    "time": 1684161900,
    "value": 1485321.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 466,
    "Unnamed: 0": 658,
    "time": 1684162200,
    "value": 1074468.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 467,
    "Unnamed: 0": 659,
    "time": 1684162500,
    "value": 2153552.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 468,
    "Unnamed: 0": 660,
    "time": 1684162800,
    "value": 1283462.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 469,
    "Unnamed: 0": 661,
    "time": 1684163100,
    "value": 1268084.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 470,
    "Unnamed: 0": 662,
    "time": 1684163400,
    "value": 1236398.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 471,
    "Unnamed: 0": 663,
    "time": 1684163700,
    "value": 1166143.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 472,
    "Unnamed: 0": 664,
    "time": 1684164000,
    "value": 899192.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 473,
    "Unnamed: 0": 665,
    "time": 1684164300,
    "value": 1175592.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 474,
    "Unnamed: 0": 666,
    "time": 1684164600,
    "value": 1291821.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 475,
    "Unnamed: 0": 667,
    "time": 1684164900,
    "value": 1362800.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 476,
    "Unnamed: 0": 668,
    "time": 1684165200,
    "value": 1136602.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 477,
    "Unnamed: 0": 669,
    "time": 1684165500,
    "value": 1566593.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 478,
    "Unnamed: 0": 670,
    "time": 1684165800,
    "value": 1249141.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 479,
    "Unnamed: 0": 671,
    "time": 1684166100,
    "value": 1172040.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 480,
    "Unnamed: 0": 672,
    "time": 1684166400,
    "value": 1127677.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 481,
    "Unnamed: 0": 673,
    "time": 1684166700,
    "value": 686863.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 482,
    "Unnamed: 0": 674,
    "time": 1684167000,
    "value": 942411.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 483,
    "Unnamed: 0": 675,
    "time": 1684167300,
    "value": 884251.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 484,
    "Unnamed: 0": 676,
    "time": 1684167600,
    "value": 516410.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 485,
    "Unnamed: 0": 677,
    "time": 1684167900,
    "value": 1043329.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 486,
    "Unnamed: 0": 678,
    "time": 1684168200,
    "value": 700028.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 487,
    "Unnamed: 0": 679,
    "time": 1684168500,
    "value": 860425.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 488,
    "Unnamed: 0": 680,
    "time": 1684168800,
    "value": 618436.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 489,
    "Unnamed: 0": 681,
    "time": 1684169100,
    "value": 757418.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 490,
    "Unnamed: 0": 682,
    "time": 1684169400,
    "value": 957672.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 491,
    "Unnamed: 0": 683,
    "time": 1684169700,
    "value": 655477.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 492,
    "Unnamed: 0": 684,
    "time": 1684170000,
    "value": 722657.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 493,
    "Unnamed: 0": 685,
    "time": 1684170300,
    "value": 601287.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 494,
    "Unnamed: 0": 686,
    "time": 1684170600,
    "value": 736926.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 495,
    "Unnamed: 0": 687,
    "time": 1684170900,
    "value": 1005906.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 496,
    "Unnamed: 0": 688,
    "time": 1684171200,
    "value": 819222.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 497,
    "Unnamed: 0": 689,
    "time": 1684171500,
    "value": 751188.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 498,
    "Unnamed: 0": 690,
    "time": 1684171800,
    "value": 1377287.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 499,
    "Unnamed: 0": 691,
    "time": 1684172100,
    "value": 862311.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 500,
    "Unnamed: 0": 692,
    "time": 1684172400,
    "value": 962256.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 501,
    "Unnamed: 0": 693,
    "time": 1684172700,
    "value": 602943.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 502,
    "Unnamed: 0": 694,
    "time": 1684173000,
    "value": 714299.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 503,
    "Unnamed: 0": 695,
    "time": 1684173300,
    "value": 572584.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 504,
    "Unnamed: 0": 696,
    "time": 1684173600,
    "value": 579901.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 505,
    "Unnamed: 0": 697,
    "time": 1684173900,
    "value": 717711.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 506,
    "Unnamed: 0": 698,
    "time": 1684174200,
    "value": 964376.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 507,
    "Unnamed: 0": 699,
    "time": 1684174500,
    "value": 678842.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 508,
    "Unnamed: 0": 700,
    "time": 1684174800,
    "value": 474576.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 509,
    "Unnamed: 0": 701,
    "time": 1684175100,
    "value": 787219.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 510,
    "Unnamed: 0": 702,
    "time": 1684175400,
    "value": 845826.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 511,
    "Unnamed: 0": 703,
    "time": 1684175700,
    "value": 522465.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 512,
    "Unnamed: 0": 704,
    "time": 1684176000,
    "value": 473446.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 513,
    "Unnamed: 0": 705,
    "time": 1684176300,
    "value": 963786.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 514,
    "Unnamed: 0": 706,
    "time": 1684176600,
    "value": 929964.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 515,
    "Unnamed: 0": 707,
    "time": 1684176900,
    "value": 767065.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 516,
    "Unnamed: 0": 708,
    "time": 1684177200,
    "value": 808386.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 517,
    "Unnamed: 0": 709,
    "time": 1684177500,
    "value": 687847.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 518,
    "Unnamed: 0": 710,
    "time": 1684177800,
    "value": 950602.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 519,
    "Unnamed: 0": 711,
    "time": 1684178100,
    "value": 755931.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 520,
    "Unnamed: 0": 712,
    "time": 1684178400,
    "value": 863212.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 521,
    "Unnamed: 0": 713,
    "time": 1684178700,
    "value": 1000869.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 522,
    "Unnamed: 0": 714,
    "time": 1684179000,
    "value": 897147.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 523,
    "Unnamed: 0": 715,
    "time": 1684179300,
    "value": 910537.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 524,
    "Unnamed: 0": 716,
    "time": 1684179600,
    "value": 840995.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 525,
    "Unnamed: 0": 717,
    "time": 1684179900,
    "value": 975696.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 526,
    "Unnamed: 0": 718,
    "time": 1684180200,
    "value": 1072705.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 527,
    "Unnamed: 0": 719,
    "time": 1684180500,
    "value": 1446841.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 528,
    "Unnamed: 0": 720,
    "time": 1684180800,
    "value": 1334123.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 529,
    "Unnamed: 0": 721,
    "time": 1684181100,
    "value": 36634.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 530,
    "Unnamed: 0": 722,
    "time": 1684181400,
    "value": 27455.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 531,
    "Unnamed: 0": 723,
    "time": 1684181700,
    "value": 19654.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 532,
    "Unnamed: 0": 724,
    "time": 1684182000,
    "value": 14844.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 533,
    "Unnamed: 0": 725,
    "time": 1684182300,
    "value": 6157.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 534,
    "Unnamed: 0": 726,
    "time": 1684182600,
    "value": 8026.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 535,
    "Unnamed: 0": 727,
    "time": 1684182900,
    "value": 13261.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 536,
    "Unnamed: 0": 728,
    "time": 1684183200,
    "value": 17453.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 537,
    "Unnamed: 0": 729,
    "time": 1684183500,
    "value": 72406.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 538,
    "Unnamed: 0": 730,
    "time": 1684183800,
    "value": 31999.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 539,
    "Unnamed: 0": 731,
    "time": 1684184100,
    "value": 33362.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 540,
    "Unnamed: 0": 732,
    "time": 1684184400,
    "value": 21825.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 541,
    "Unnamed: 0": 733,
    "time": 1684184700,
    "value": 22358.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 542,
    "Unnamed: 0": 734,
    "time": 1684185000,
    "value": 18432.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 543,
    "Unnamed: 0": 735,
    "time": 1684185300,
    "value": 4361.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 544,
    "Unnamed: 0": 736,
    "time": 1684185600,
    "value": 7399.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 545,
    "Unnamed: 0": 737,
    "time": 1684185900,
    "value": 8606.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 546,
    "Unnamed: 0": 738,
    "time": 1684186200,
    "value": 16414.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 547,
    "Unnamed: 0": 739,
    "time": 1684186500,
    "value": 11073.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 548,
    "Unnamed: 0": 740,
    "time": 1684186800,
    "value": 6591.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 549,
    "Unnamed: 0": 741,
    "time": 1684187100,
    "value": 4930.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 550,
    "Unnamed: 0": 742,
    "time": 1684187400,
    "value": 27758.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 551,
    "Unnamed: 0": 743,
    "time": 1684187700,
    "value": 13420.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 552,
    "Unnamed: 0": 744,
    "time": 1684188000,
    "value": 8643.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 553,
    "Unnamed: 0": 745,
    "time": 1684188300,
    "value": 3553.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 554,
    "Unnamed: 0": 746,
    "time": 1684188600,
    "value": 7754.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 555,
    "Unnamed: 0": 747,
    "time": 1684188900,
    "value": 8700.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 556,
    "Unnamed: 0": 748,
    "time": 1684189200,
    "value": 7121.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 557,
    "Unnamed: 0": 749,
    "time": 1684189500,
    "value": 12917.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 558,
    "Unnamed: 0": 750,
    "time": 1684189800,
    "value": 6857.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 559,
    "Unnamed: 0": 751,
    "time": 1684190100,
    "value": 5082.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 560,
    "Unnamed: 0": 752,
    "time": 1684190400,
    "value": 7436.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 561,
    "Unnamed: 0": 753,
    "time": 1684190700,
    "value": 3350.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 562,
    "Unnamed: 0": 754,
    "time": 1684191000,
    "value": 4405.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 563,
    "Unnamed: 0": 755,
    "time": 1684191300,
    "value": 1937.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 564,
    "Unnamed: 0": 756,
    "time": 1684191600,
    "value": 12388.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 565,
    "Unnamed: 0": 757,
    "time": 1684191900,
    "value": 7931.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 566,
    "Unnamed: 0": 758,
    "time": 1684192200,
    "value": 3948.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 567,
    "Unnamed: 0": 759,
    "time": 1684192500,
    "value": 4265.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 568,
    "Unnamed: 0": 760,
    "time": 1684192800,
    "value": 1927.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 569,
    "Unnamed: 0": 761,
    "time": 1684193100,
    "value": 3919.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 570,
    "Unnamed: 0": 762,
    "time": 1684193400,
    "value": 8934.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 571,
    "Unnamed: 0": 763,
    "time": 1684193700,
    "value": 6408.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 572,
    "Unnamed: 0": 764,
    "time": 1684194000,
    "value": 5284.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 573,
    "Unnamed: 0": 765,
    "time": 1684194300,
    "value": 11600.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 574,
    "Unnamed: 0": 766,
    "time": 1684194600,
    "value": 15489.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 575,
    "Unnamed: 0": 767,
    "time": 1684194900,
    "value": 39750.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 576,
    "Unnamed: 0": 768,
    "time": 1684310400,
    "value": 22369.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 577,
    "Unnamed: 0": 769,
    "time": 1684310700,
    "value": 7963.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 578,
    "Unnamed: 0": 770,
    "time": 1684311000,
    "value": 4374.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 579,
    "Unnamed: 0": 771,
    "time": 1684311300,
    "value": 2857.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 580,
    "Unnamed: 0": 772,
    "time": 1684311600,
    "value": 7544.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 581,
    "Unnamed: 0": 773,
    "time": 1684311900,
    "value": 3094.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 582,
    "Unnamed: 0": 774,
    "time": 1684312200,
    "value": 1723.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 583,
    "Unnamed: 0": 775,
    "time": 1684312500,
    "value": 1940.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 584,
    "Unnamed: 0": 776,
    "time": 1684312800,
    "value": 3909.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 585,
    "Unnamed: 0": 777,
    "time": 1684313100,
    "value": 4432.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 586,
    "Unnamed: 0": 778,
    "time": 1684313400,
    "value": 4009.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 587,
    "Unnamed: 0": 779,
    "time": 1684313700,
    "value": 3672.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 588,
    "Unnamed: 0": 780,
    "time": 1684314000,
    "value": 4234.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 589,
    "Unnamed: 0": 781,
    "time": 1684314300,
    "value": 2860.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 590,
    "Unnamed: 0": 782,
    "time": 1684314600,
    "value": 4602.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 591,
    "Unnamed: 0": 783,
    "time": 1684314900,
    "value": 653.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 592,
    "Unnamed: 0": 784,
    "time": 1684315200,
    "value": 279.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 593,
    "Unnamed: 0": 785,
    "time": 1684315500,
    "value": 2932.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 594,
    "Unnamed: 0": 786,
    "time": 1684315800,
    "value": 3477.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 595,
    "Unnamed: 0": 787,
    "time": 1684316100,
    "value": 849.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 596,
    "Unnamed: 0": 788,
    "time": 1684316400,
    "value": 4562.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 597,
    "Unnamed: 0": 789,
    "time": 1684316700,
    "value": 4784.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 598,
    "Unnamed: 0": 790,
    "time": 1684317000,
    "value": 3372.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 599,
    "Unnamed: 0": 791,
    "time": 1684317300,
    "value": 5959.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 600,
    "Unnamed: 0": 792,
    "time": 1684317600,
    "value": 3396.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 601,
    "Unnamed: 0": 793,
    "time": 1684317900,
    "value": 962.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 602,
    "Unnamed: 0": 794,
    "time": 1684318200,
    "value": 4039.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 603,
    "Unnamed: 0": 795,
    "time": 1684318500,
    "value": 6967.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 604,
    "Unnamed: 0": 796,
    "time": 1684318800,
    "value": 8261.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 605,
    "Unnamed: 0": 797,
    "time": 1684319100,
    "value": 2738.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 606,
    "Unnamed: 0": 798,
    "time": 1684319400,
    "value": 3196.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 607,
    "Unnamed: 0": 799,
    "time": 1684319700,
    "value": 6891.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 608,
    "Unnamed: 0": 800,
    "time": 1684320000,
    "value": 3140.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 609,
    "Unnamed: 0": 801,
    "time": 1684320300,
    "value": 2744.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 610,
    "Unnamed: 0": 802,
    "time": 1684320600,
    "value": 1369.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 611,
    "Unnamed: 0": 803,
    "time": 1684320900,
    "value": 10297.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 612,
    "Unnamed: 0": 804,
    "time": 1684321200,
    "value": 64135.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 613,
    "Unnamed: 0": 805,
    "time": 1684321500,
    "value": 27817.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 614,
    "Unnamed: 0": 806,
    "time": 1684321800,
    "value": 25625.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 615,
    "Unnamed: 0": 807,
    "time": 1684322100,
    "value": 39460.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 616,
    "Unnamed: 0": 808,
    "time": 1684322400,
    "value": 11640.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 617,
    "Unnamed: 0": 809,
    "time": 1684322700,
    "value": 11661.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 618,
    "Unnamed: 0": 810,
    "time": 1684323000,
    "value": 11849.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 619,
    "Unnamed: 0": 811,
    "time": 1684323300,
    "value": 12255.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 620,
    "Unnamed: 0": 812,
    "time": 1684323600,
    "value": 15820.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 621,
    "Unnamed: 0": 813,
    "time": 1684323900,
    "value": 4235.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 622,
    "Unnamed: 0": 814,
    "time": 1684324200,
    "value": 8318.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 623,
    "Unnamed: 0": 815,
    "time": 1684324500,
    "value": 2492.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 624,
    "Unnamed: 0": 816,
    "time": 1684324800,
    "value": 254856.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 625,
    "Unnamed: 0": 817,
    "time": 1684325100,
    "value": 48052.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 626,
    "Unnamed: 0": 818,
    "time": 1684325400,
    "value": 36045.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 627,
    "Unnamed: 0": 819,
    "time": 1684325700,
    "value": 33019.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 628,
    "Unnamed: 0": 820,
    "time": 1684326000,
    "value": 44151.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 629,
    "Unnamed: 0": 821,
    "time": 1684326300,
    "value": 45634.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 630,
    "Unnamed: 0": 822,
    "time": 1684326600,
    "value": 55131.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 631,
    "Unnamed: 0": 823,
    "time": 1684326900,
    "value": 30749.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 632,
    "Unnamed: 0": 824,
    "time": 1684327200,
    "value": 32653.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 633,
    "Unnamed: 0": 825,
    "time": 1684327500,
    "value": 31536.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 634,
    "Unnamed: 0": 826,
    "time": 1684327800,
    "value": 30046.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 635,
    "Unnamed: 0": 827,
    "time": 1684328100,
    "value": 37352.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 636,
    "Unnamed: 0": 828,
    "time": 1684328400,
    "value": 45051.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 637,
    "Unnamed: 0": 829,
    "time": 1684328700,
    "value": 40038.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 638,
    "Unnamed: 0": 830,
    "time": 1684329000,
    "value": 27711.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 639,
    "Unnamed: 0": 831,
    "time": 1684329300,
    "value": 19216.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 640,
    "Unnamed: 0": 832,
    "time": 1684329600,
    "value": 53914.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 641,
    "Unnamed: 0": 833,
    "time": 1684329900,
    "value": 90976.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 642,
    "Unnamed: 0": 834,
    "time": 1684330200,
    "value": 3237526.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 643,
    "Unnamed: 0": 835,
    "time": 1684330500,
    "value": 2348795.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 644,
    "Unnamed: 0": 836,
    "time": 1684330800,
    "value": 4096219.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 645,
    "Unnamed: 0": 837,
    "time": 1684331100,
    "value": 3607257.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 646,
    "Unnamed: 0": 838,
    "time": 1684331400,
    "value": 2868151.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 647,
    "Unnamed: 0": 839,
    "time": 1684331700,
    "value": 1839049.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 648,
    "Unnamed: 0": 840,
    "time": 1684332000,
    "value": 2296906.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 649,
    "Unnamed: 0": 841,
    "time": 1684332300,
    "value": 2889474.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 650,
    "Unnamed: 0": 842,
    "time": 1684332600,
    "value": 3484522.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 651,
    "Unnamed: 0": 843,
    "time": 1684332900,
    "value": 2207691.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 652,
    "Unnamed: 0": 844,
    "time": 1684333200,
    "value": 1956938.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 653,
    "Unnamed: 0": 845,
    "time": 1684333500,
    "value": 1712496.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 654,
    "Unnamed: 0": 846,
    "time": 1684333800,
    "value": 2633178.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 655,
    "Unnamed: 0": 847,
    "time": 1684334100,
    "value": 2096127.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 656,
    "Unnamed: 0": 848,
    "time": 1684334400,
    "value": 1730105.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 657,
    "Unnamed: 0": 849,
    "time": 1684334700,
    "value": 2453817.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 658,
    "Unnamed: 0": 850,
    "time": 1684335000,
    "value": 2651801.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 659,
    "Unnamed: 0": 851,
    "time": 1684335300,
    "value": 2085515.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 660,
    "Unnamed: 0": 852,
    "time": 1684335600,
    "value": 1904058.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 661,
    "Unnamed: 0": 853,
    "time": 1684335900,
    "value": 1771292.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 662,
    "Unnamed: 0": 854,
    "time": 1684336200,
    "value": 1738681.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 663,
    "Unnamed: 0": 855,
    "time": 1684336500,
    "value": 1844009.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 664,
    "Unnamed: 0": 856,
    "time": 1684336800,
    "value": 1500089.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 665,
    "Unnamed: 0": 857,
    "time": 1684337100,
    "value": 1128781.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 666,
    "Unnamed: 0": 858,
    "time": 1684337400,
    "value": 934139.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 667,
    "Unnamed: 0": 859,
    "time": 1684337700,
    "value": 1115222.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 668,
    "Unnamed: 0": 860,
    "time": 1684338000,
    "value": 1134111.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 669,
    "Unnamed: 0": 861,
    "time": 1684338300,
    "value": 1351075.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 670,
    "Unnamed: 0": 862,
    "time": 1684338600,
    "value": 928504.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 671,
    "Unnamed: 0": 863,
    "time": 1684338900,
    "value": 906862.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 672,
    "Unnamed: 0": 864,
    "time": 1684339200,
    "value": 906361.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 673,
    "Unnamed: 0": 865,
    "time": 1684339500,
    "value": 1078571.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 674,
    "Unnamed: 0": 866,
    "time": 1684339800,
    "value": 714565.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 675,
    "Unnamed: 0": 867,
    "time": 1684340100,
    "value": 938732.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 676,
    "Unnamed: 0": 868,
    "time": 1684340400,
    "value": 822914.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 677,
    "Unnamed: 0": 869,
    "time": 1684340700,
    "value": 1090598.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 678,
    "Unnamed: 0": 870,
    "time": 1684341000,
    "value": 1025232.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 679,
    "Unnamed: 0": 871,
    "time": 1684341300,
    "value": 783554.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 680,
    "Unnamed: 0": 872,
    "time": 1684341600,
    "value": 796927.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 681,
    "Unnamed: 0": 873,
    "time": 1684341900,
    "value": 777882.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 682,
    "Unnamed: 0": 874,
    "time": 1684342200,
    "value": 604312.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 683,
    "Unnamed: 0": 875,
    "time": 1684342500,
    "value": 925942.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 684,
    "Unnamed: 0": 876,
    "time": 1684342800,
    "value": 767561.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 685,
    "Unnamed: 0": 877,
    "time": 1684343100,
    "value": 866314.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 686,
    "Unnamed: 0": 878,
    "time": 1684343400,
    "value": 567099.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 687,
    "Unnamed: 0": 879,
    "time": 1684343700,
    "value": 656240.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 688,
    "Unnamed: 0": 880,
    "time": 1684344000,
    "value": 801136.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 689,
    "Unnamed: 0": 881,
    "time": 1684344300,
    "value": 684316.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 690,
    "Unnamed: 0": 882,
    "time": 1684344600,
    "value": 880024.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 691,
    "Unnamed: 0": 883,
    "time": 1684344900,
    "value": 1723090.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 692,
    "Unnamed: 0": 884,
    "time": 1684345200,
    "value": 749723.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 693,
    "Unnamed: 0": 885,
    "time": 1684345500,
    "value": 801425.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 694,
    "Unnamed: 0": 886,
    "time": 1684345800,
    "value": 787372.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 695,
    "Unnamed: 0": 887,
    "time": 1684346100,
    "value": 569371.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 696,
    "Unnamed: 0": 888,
    "time": 1684346400,
    "value": 692782.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 697,
    "Unnamed: 0": 889,
    "time": 1684346700,
    "value": 882995.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 698,
    "Unnamed: 0": 890,
    "time": 1684347000,
    "value": 607256.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 699,
    "Unnamed: 0": 891,
    "time": 1684347300,
    "value": 623099.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 700,
    "Unnamed: 0": 892,
    "time": 1684347600,
    "value": 681688.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 701,
    "Unnamed: 0": 893,
    "time": 1684347900,
    "value": 724313.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 702,
    "Unnamed: 0": 894,
    "time": 1684348200,
    "value": 778009.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 703,
    "Unnamed: 0": 895,
    "time": 1684348500,
    "value": 876929.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 704,
    "Unnamed: 0": 896,
    "time": 1684348800,
    "value": 948306.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 705,
    "Unnamed: 0": 897,
    "time": 1684349100,
    "value": 933124.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 706,
    "Unnamed: 0": 898,
    "time": 1684349400,
    "value": 603297.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 707,
    "Unnamed: 0": 899,
    "time": 1684349700,
    "value": 576137.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 708,
    "Unnamed: 0": 900,
    "time": 1684350000,
    "value": 896119.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 709,
    "Unnamed: 0": 901,
    "time": 1684350300,
    "value": 1030060.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 710,
    "Unnamed: 0": 902,
    "time": 1684350600,
    "value": 1034142.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 711,
    "Unnamed: 0": 903,
    "time": 1684350900,
    "value": 776574.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 712,
    "Unnamed: 0": 904,
    "time": 1684351200,
    "value": 780633.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 713,
    "Unnamed: 0": 905,
    "time": 1684351500,
    "value": 573551.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 714,
    "Unnamed: 0": 906,
    "time": 1684351800,
    "value": 714225.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 715,
    "Unnamed: 0": 907,
    "time": 1684352100,
    "value": 1059065.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 716,
    "Unnamed: 0": 908,
    "time": 1684352400,
    "value": 1040799.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 717,
    "Unnamed: 0": 909,
    "time": 1684352700,
    "value": 769384.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 718,
    "Unnamed: 0": 910,
    "time": 1684353000,
    "value": 1564731.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 719,
    "Unnamed: 0": 911,
    "time": 1684353300,
    "value": 1803519.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 720,
    "Unnamed: 0": 912,
    "time": 1684353600,
    "value": 2406815.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 721,
    "Unnamed: 0": 913,
    "time": 1684353900,
    "value": 97778.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 722,
    "Unnamed: 0": 914,
    "time": 1684354200,
    "value": 25230.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 723,
    "Unnamed: 0": 915,
    "time": 1684354500,
    "value": 32255.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 724,
    "Unnamed: 0": 916,
    "time": 1684354800,
    "value": 23698.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 725,
    "Unnamed: 0": 917,
    "time": 1684355100,
    "value": 21001.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 726,
    "Unnamed: 0": 918,
    "time": 1684355400,
    "value": 23223.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 727,
    "Unnamed: 0": 919,
    "time": 1684355700,
    "value": 20175.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 728,
    "Unnamed: 0": 920,
    "time": 1684356000,
    "value": 15935.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 729,
    "Unnamed: 0": 921,
    "time": 1684356300,
    "value": 16154.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 730,
    "Unnamed: 0": 922,
    "time": 1684356600,
    "value": 14089.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 731,
    "Unnamed: 0": 923,
    "time": 1684356900,
    "value": 16345.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 732,
    "Unnamed: 0": 924,
    "time": 1684357200,
    "value": 5963.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 733,
    "Unnamed: 0": 925,
    "time": 1684357500,
    "value": 3216.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 734,
    "Unnamed: 0": 926,
    "time": 1684357800,
    "value": 11031.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 735,
    "Unnamed: 0": 927,
    "time": 1684358100,
    "value": 13774.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 736,
    "Unnamed: 0": 928,
    "time": 1684358400,
    "value": 3954.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 737,
    "Unnamed: 0": 929,
    "time": 1684358700,
    "value": 9308.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 738,
    "Unnamed: 0": 930,
    "time": 1684359000,
    "value": 3773.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 739,
    "Unnamed: 0": 931,
    "time": 1684359300,
    "value": 5878.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 740,
    "Unnamed: 0": 932,
    "time": 1684359600,
    "value": 12007.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 741,
    "Unnamed: 0": 933,
    "time": 1684359900,
    "value": 10480.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 742,
    "Unnamed: 0": 934,
    "time": 1684360200,
    "value": 4880.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 743,
    "Unnamed: 0": 935,
    "time": 1684360500,
    "value": 6552.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 744,
    "Unnamed: 0": 936,
    "time": 1684360800,
    "value": 11787.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 745,
    "Unnamed: 0": 937,
    "time": 1684361100,
    "value": 15206.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 746,
    "Unnamed: 0": 938,
    "time": 1684361400,
    "value": 18374.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 747,
    "Unnamed: 0": 939,
    "time": 1684361700,
    "value": 2131.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 748,
    "Unnamed: 0": 940,
    "time": 1684362000,
    "value": 8059.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 749,
    "Unnamed: 0": 941,
    "time": 1684362300,
    "value": 2573.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 750,
    "Unnamed: 0": 942,
    "time": 1684362600,
    "value": 7128.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 751,
    "Unnamed: 0": 943,
    "time": 1684362900,
    "value": 9358.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 752,
    "Unnamed: 0": 944,
    "time": 1684363200,
    "value": 10285.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 753,
    "Unnamed: 0": 945,
    "time": 1684363500,
    "value": 5355.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 754,
    "Unnamed: 0": 946,
    "time": 1684363800,
    "value": 8443.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 755,
    "Unnamed: 0": 947,
    "time": 1684364100,
    "value": 7631.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 756,
    "Unnamed: 0": 948,
    "time": 1684364400,
    "value": 4598.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 757,
    "Unnamed: 0": 949,
    "time": 1684364700,
    "value": 4738.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 758,
    "Unnamed: 0": 950,
    "time": 1684365000,
    "value": 4345.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 759,
    "Unnamed: 0": 951,
    "time": 1684365300,
    "value": 6913.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 760,
    "Unnamed: 0": 952,
    "time": 1684365600,
    "value": 4873.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 761,
    "Unnamed: 0": 953,
    "time": 1684365900,
    "value": 4930.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 762,
    "Unnamed: 0": 954,
    "time": 1684366200,
    "value": 8378.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 763,
    "Unnamed: 0": 955,
    "time": 1684366500,
    "value": 4144.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 764,
    "Unnamed: 0": 956,
    "time": 1684366800,
    "value": 4114.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 765,
    "Unnamed: 0": 957,
    "time": 1684367100,
    "value": 10147.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 766,
    "Unnamed: 0": 958,
    "time": 1684367400,
    "value": 9021.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 767,
    "Unnamed: 0": 959,
    "time": 1684367700,
    "value": 45786.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 768,
    "Unnamed: 0": 960,
    "time": 1684396800,
    "value": 8324.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 769,
    "Unnamed: 0": 961,
    "time": 1684397100,
    "value": 11595.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 770,
    "Unnamed: 0": 962,
    "time": 1684397400,
    "value": 5772.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 771,
    "Unnamed: 0": 963,
    "time": 1684397700,
    "value": 4714.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 772,
    "Unnamed: 0": 964,
    "time": 1684398000,
    "value": 6690.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 773,
    "Unnamed: 0": 965,
    "time": 1684398300,
    "value": 3797.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 774,
    "Unnamed: 0": 966,
    "time": 1684398600,
    "value": 1607.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 775,
    "Unnamed: 0": 967,
    "time": 1684398900,
    "value": 529.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 776,
    "Unnamed: 0": 968,
    "time": 1684399200,
    "value": 895.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 777,
    "Unnamed: 0": 969,
    "time": 1684399500,
    "value": 500.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 778,
    "Unnamed: 0": 970,
    "time": 1684399800,
    "value": 1700.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 779,
    "Unnamed: 0": 971,
    "time": 1684400100,
    "value": 566.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 780,
    "Unnamed: 0": 972,
    "time": 1684400400,
    "value": 2563.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 781,
    "Unnamed: 0": 973,
    "time": 1684400700,
    "value": 2097.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 782,
    "Unnamed: 0": 974,
    "time": 1684401000,
    "value": 936.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 783,
    "Unnamed: 0": 975,
    "time": 1684401300,
    "value": 700.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 784,
    "Unnamed: 0": 976,
    "time": 1684401600,
    "value": 2137.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 785,
    "Unnamed: 0": 977,
    "time": 1684401900,
    "value": 599.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 786,
    "Unnamed: 0": 978,
    "time": 1684402200,
    "value": 4087.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 787,
    "Unnamed: 0": 979,
    "time": 1684402500,
    "value": 1755.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 788,
    "Unnamed: 0": 980,
    "time": 1684402800,
    "value": 303.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 789,
    "Unnamed: 0": 981,
    "time": 1684403100,
    "value": 3661.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 790,
    "Unnamed: 0": 982,
    "time": 1684403400,
    "value": 1121.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 791,
    "Unnamed: 0": 983,
    "time": 1684403700,
    "value": 20785.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 792,
    "Unnamed: 0": 984,
    "time": 1684404000,
    "value": 3160.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 793,
    "Unnamed: 0": 985,
    "time": 1684404300,
    "value": 1511.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 794,
    "Unnamed: 0": 986,
    "time": 1684404600,
    "value": 680.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 795,
    "Unnamed: 0": 987,
    "time": 1684404900,
    "value": 2187.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 796,
    "Unnamed: 0": 988,
    "time": 1684405200,
    "value": 1149.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 797,
    "Unnamed: 0": 989,
    "time": 1684405500,
    "value": 2513.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 798,
    "Unnamed: 0": 990,
    "time": 1684405800,
    "value": 2393.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 799,
    "Unnamed: 0": 991,
    "time": 1684406100,
    "value": 2742.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 800,
    "Unnamed: 0": 992,
    "time": 1684406400,
    "value": 1900.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 801,
    "Unnamed: 0": 993,
    "time": 1684406700,
    "value": 2141.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 802,
    "Unnamed: 0": 994,
    "time": 1684407000,
    "value": 1752.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 803,
    "Unnamed: 0": 995,
    "time": 1684407300,
    "value": 16114.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 804,
    "Unnamed: 0": 996,
    "time": 1684407600,
    "value": 58003.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 805,
    "Unnamed: 0": 997,
    "time": 1684407900,
    "value": 62014.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 806,
    "Unnamed: 0": 998,
    "time": 1684408200,
    "value": 15824.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 807,
    "Unnamed: 0": 999,
    "time": 1684408500,
    "value": 19799.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 808,
    "Unnamed: 0": 1000,
    "time": 1684408800,
    "value": 17814.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 809,
    "Unnamed: 0": 1001,
    "time": 1684409100,
    "value": 7383.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 810,
    "Unnamed: 0": 1002,
    "time": 1684409400,
    "value": 16917.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 811,
    "Unnamed: 0": 1003,
    "time": 1684409700,
    "value": 8922.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 812,
    "Unnamed: 0": 1004,
    "time": 1684410000,
    "value": 7478.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 813,
    "Unnamed: 0": 1005,
    "time": 1684410300,
    "value": 8709.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 814,
    "Unnamed: 0": 1006,
    "time": 1684410600,
    "value": 5574.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 815,
    "Unnamed: 0": 1007,
    "time": 1684410900,
    "value": 18620.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 816,
    "Unnamed: 0": 1008,
    "time": 1684411200,
    "value": 200096.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 817,
    "Unnamed: 0": 1009,
    "time": 1684411500,
    "value": 63463.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 818,
    "Unnamed: 0": 1010,
    "time": 1684411800,
    "value": 63234.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 819,
    "Unnamed: 0": 1011,
    "time": 1684412100,
    "value": 64392.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 820,
    "Unnamed: 0": 1012,
    "time": 1684412400,
    "value": 35241.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 821,
    "Unnamed: 0": 1013,
    "time": 1684412700,
    "value": 61996.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 822,
    "Unnamed: 0": 1014,
    "time": 1684413000,
    "value": 86791.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 823,
    "Unnamed: 0": 1015,
    "time": 1684413300,
    "value": 34903.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 824,
    "Unnamed: 0": 1016,
    "time": 1684413600,
    "value": 44046.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 825,
    "Unnamed: 0": 1017,
    "time": 1684413900,
    "value": 43765.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 826,
    "Unnamed: 0": 1018,
    "time": 1684414200,
    "value": 150616.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 827,
    "Unnamed: 0": 1019,
    "time": 1684414500,
    "value": 92190.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 828,
    "Unnamed: 0": 1020,
    "time": 1684414800,
    "value": 87797.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 829,
    "Unnamed: 0": 1021,
    "time": 1684415100,
    "value": 73437.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 830,
    "Unnamed: 0": 1022,
    "time": 1684415400,
    "value": 75807.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 831,
    "Unnamed: 0": 1023,
    "time": 1684415700,
    "value": 47777.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 832,
    "Unnamed: 0": 1024,
    "time": 1684416000,
    "value": 38932.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 833,
    "Unnamed: 0": 1025,
    "time": 1684416300,
    "value": 43303.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 834,
    "Unnamed: 0": 1026,
    "time": 1684416600,
    "value": 3514968.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 835,
    "Unnamed: 0": 1027,
    "time": 1684416900,
    "value": 3270920.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 836,
    "Unnamed: 0": 1028,
    "time": 1684417200,
    "value": 2908935.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 837,
    "Unnamed: 0": 1029,
    "time": 1684417500,
    "value": 2092070.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 838,
    "Unnamed: 0": 1030,
    "time": 1684417800,
    "value": 2432506.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 839,
    "Unnamed: 0": 1031,
    "time": 1684418100,
    "value": 1782370.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 840,
    "Unnamed: 0": 1032,
    "time": 1684418400,
    "value": 1692163.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 841,
    "Unnamed: 0": 1033,
    "time": 1684418700,
    "value": 1535773.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 842,
    "Unnamed: 0": 1034,
    "time": 1684419000,
    "value": 1534923.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 843,
    "Unnamed: 0": 1035,
    "time": 1684419300,
    "value": 2094809.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 844,
    "Unnamed: 0": 1036,
    "time": 1684419600,
    "value": 2508478.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 845,
    "Unnamed: 0": 1037,
    "time": 1684419900,
    "value": 2030405.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 846,
    "Unnamed: 0": 1038,
    "time": 1684420200,
    "value": 1803855.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 847,
    "Unnamed: 0": 1039,
    "time": 1684420500,
    "value": 1629094.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 848,
    "Unnamed: 0": 1040,
    "time": 1684420800,
    "value": 1358540.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 849,
    "Unnamed: 0": 1041,
    "time": 1684421100,
    "value": 1478732.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 850,
    "Unnamed: 0": 1042,
    "time": 1684421400,
    "value": 1149048.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 851,
    "Unnamed: 0": 1043,
    "time": 1684421700,
    "value": 1063204.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 852,
    "Unnamed: 0": 1044,
    "time": 1684422000,
    "value": 1138933.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 853,
    "Unnamed: 0": 1045,
    "time": 1684422300,
    "value": 1323973.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 854,
    "Unnamed: 0": 1046,
    "time": 1684422600,
    "value": 1069171.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 855,
    "Unnamed: 0": 1047,
    "time": 1684422900,
    "value": 1056949.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 856,
    "Unnamed: 0": 1048,
    "time": 1684423200,
    "value": 854219.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 857,
    "Unnamed: 0": 1049,
    "time": 1684423500,
    "value": 1380923.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 858,
    "Unnamed: 0": 1050,
    "time": 1684423800,
    "value": 1329295.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 859,
    "Unnamed: 0": 1051,
    "time": 1684424100,
    "value": 1204080.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 860,
    "Unnamed: 0": 1052,
    "time": 1684424400,
    "value": 781697.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 861,
    "Unnamed: 0": 1053,
    "time": 1684424700,
    "value": 984477.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 862,
    "Unnamed: 0": 1054,
    "time": 1684425000,
    "value": 1278577.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 863,
    "Unnamed: 0": 1055,
    "time": 1684425300,
    "value": 1110620.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 864,
    "Unnamed: 0": 1056,
    "time": 1684425600,
    "value": 784523.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 865,
    "Unnamed: 0": 1057,
    "time": 1684425900,
    "value": 1097927.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 866,
    "Unnamed: 0": 1058,
    "time": 1684426200,
    "value": 947748.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 867,
    "Unnamed: 0": 1059,
    "time": 1684426500,
    "value": 867325.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 868,
    "Unnamed: 0": 1060,
    "time": 1684426800,
    "value": 707158.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 869,
    "Unnamed: 0": 1061,
    "time": 1684427100,
    "value": 857784.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 870,
    "Unnamed: 0": 1062,
    "time": 1684427400,
    "value": 802604.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 871,
    "Unnamed: 0": 1063,
    "time": 1684427700,
    "value": 885123.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 872,
    "Unnamed: 0": 1064,
    "time": 1684428000,
    "value": 776585.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 873,
    "Unnamed: 0": 1065,
    "time": 1684428300,
    "value": 1046430.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 874,
    "Unnamed: 0": 1066,
    "time": 1684428600,
    "value": 869964.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 875,
    "Unnamed: 0": 1067,
    "time": 1684428900,
    "value": 731636.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 876,
    "Unnamed: 0": 1068,
    "time": 1684429200,
    "value": 700337.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 877,
    "Unnamed: 0": 1069,
    "time": 1684429500,
    "value": 511099.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 878,
    "Unnamed: 0": 1070,
    "time": 1684429800,
    "value": 580186.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 879,
    "Unnamed: 0": 1071,
    "time": 1684430100,
    "value": 821861.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 880,
    "Unnamed: 0": 1072,
    "time": 1684430400,
    "value": 828124.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 881,
    "Unnamed: 0": 1073,
    "time": 1684430700,
    "value": 1099719.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 882,
    "Unnamed: 0": 1074,
    "time": 1684431000,
    "value": 647871.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 883,
    "Unnamed: 0": 1075,
    "time": 1684431300,
    "value": 538687.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 884,
    "Unnamed: 0": 1076,
    "time": 1684431600,
    "value": 612662.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 885,
    "Unnamed: 0": 1077,
    "time": 1684431900,
    "value": 704570.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 886,
    "Unnamed: 0": 1078,
    "time": 1684432200,
    "value": 473376.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 887,
    "Unnamed: 0": 1079,
    "time": 1684432500,
    "value": 592400.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 888,
    "Unnamed: 0": 1080,
    "time": 1684432800,
    "value": 823361.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 889,
    "Unnamed: 0": 1081,
    "time": 1684433100,
    "value": 711214.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 890,
    "Unnamed: 0": 1082,
    "time": 1684433400,
    "value": 706974.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 891,
    "Unnamed: 0": 1083,
    "time": 1684433700,
    "value": 547299.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 892,
    "Unnamed: 0": 1084,
    "time": 1684434000,
    "value": 675020.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 893,
    "Unnamed: 0": 1085,
    "time": 1684434300,
    "value": 671612.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 894,
    "Unnamed: 0": 1086,
    "time": 1684434600,
    "value": 664912.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 895,
    "Unnamed: 0": 1087,
    "time": 1684434900,
    "value": 498966.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 896,
    "Unnamed: 0": 1088,
    "time": 1684435200,
    "value": 984186.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 897,
    "Unnamed: 0": 1089,
    "time": 1684435500,
    "value": 662732.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 898,
    "Unnamed: 0": 1090,
    "time": 1684435800,
    "value": 552146.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 899,
    "Unnamed: 0": 1091,
    "time": 1684436100,
    "value": 489129.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 900,
    "Unnamed: 0": 1092,
    "time": 1684436400,
    "value": 601242.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 901,
    "Unnamed: 0": 1093,
    "time": 1684436700,
    "value": 423555.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 902,
    "Unnamed: 0": 1094,
    "time": 1684437000,
    "value": 1707537.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 903,
    "Unnamed: 0": 1095,
    "time": 1684437300,
    "value": 1111125.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 904,
    "Unnamed: 0": 1096,
    "time": 1684437600,
    "value": 975745.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 905,
    "Unnamed: 0": 1097,
    "time": 1684437900,
    "value": 688070.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 906,
    "Unnamed: 0": 1098,
    "time": 1684438200,
    "value": 1073060.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 907,
    "Unnamed: 0": 1099,
    "time": 1684438500,
    "value": 745812.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 908,
    "Unnamed: 0": 1100,
    "time": 1684438800,
    "value": 1028588.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 909,
    "Unnamed: 0": 1101,
    "time": 1684439100,
    "value": 960221.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 910,
    "Unnamed: 0": 1102,
    "time": 1684439400,
    "value": 1232764.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 911,
    "Unnamed: 0": 1103,
    "time": 1684439700,
    "value": 2348710.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 912,
    "Unnamed: 0": 1104,
    "time": 1684440000,
    "value": 2255806.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 913,
    "Unnamed: 0": 1105,
    "time": 1684440300,
    "value": 71629.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 914,
    "Unnamed: 0": 1106,
    "time": 1684440600,
    "value": 31207.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 915,
    "Unnamed: 0": 1107,
    "time": 1684440900,
    "value": 28740.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 916,
    "Unnamed: 0": 1108,
    "time": 1684441200,
    "value": 17903.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 917,
    "Unnamed: 0": 1109,
    "time": 1684441500,
    "value": 50095.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 918,
    "Unnamed: 0": 1110,
    "time": 1684441800,
    "value": 50192.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 919,
    "Unnamed: 0": 1111,
    "time": 1684442100,
    "value": 42049.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 920,
    "Unnamed: 0": 1112,
    "time": 1684442400,
    "value": 16328.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 921,
    "Unnamed: 0": 1113,
    "time": 1684442700,
    "value": 14464.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 922,
    "Unnamed: 0": 1114,
    "time": 1684443000,
    "value": 8837.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 923,
    "Unnamed: 0": 1115,
    "time": 1684443300,
    "value": 14585.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 924,
    "Unnamed: 0": 1116,
    "time": 1684443600,
    "value": 11833.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 925,
    "Unnamed: 0": 1117,
    "time": 1684443900,
    "value": 10116.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 926,
    "Unnamed: 0": 1118,
    "time": 1684444200,
    "value": 9430.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 927,
    "Unnamed: 0": 1119,
    "time": 1684444500,
    "value": 7830.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 928,
    "Unnamed: 0": 1120,
    "time": 1684444800,
    "value": 6784.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 929,
    "Unnamed: 0": 1121,
    "time": 1684445100,
    "value": 14323.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 930,
    "Unnamed: 0": 1122,
    "time": 1684445400,
    "value": 3191.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 931,
    "Unnamed: 0": 1123,
    "time": 1684445700,
    "value": 4584.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 932,
    "Unnamed: 0": 1124,
    "time": 1684446000,
    "value": 4697.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 933,
    "Unnamed: 0": 1125,
    "time": 1684446300,
    "value": 3150.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 934,
    "Unnamed: 0": 1126,
    "time": 1684446600,
    "value": 3525.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 935,
    "Unnamed: 0": 1127,
    "time": 1684446900,
    "value": 11845.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 936,
    "Unnamed: 0": 1128,
    "time": 1684447200,
    "value": 14318.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 937,
    "Unnamed: 0": 1129,
    "time": 1684447500,
    "value": 42681.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 938,
    "Unnamed: 0": 1130,
    "time": 1684447800,
    "value": 58244.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 939,
    "Unnamed: 0": 1131,
    "time": 1684448100,
    "value": 18530.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 940,
    "Unnamed: 0": 1132,
    "time": 1684448400,
    "value": 24668.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 941,
    "Unnamed: 0": 1133,
    "time": 1684448700,
    "value": 56402.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 942,
    "Unnamed: 0": 1134,
    "time": 1684449000,
    "value": 78543.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 943,
    "Unnamed: 0": 1135,
    "time": 1684449300,
    "value": 148364.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 944,
    "Unnamed: 0": 1136,
    "time": 1684449600,
    "value": 101439.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 945,
    "Unnamed: 0": 1137,
    "time": 1684449900,
    "value": 57940.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 946,
    "Unnamed: 0": 1138,
    "time": 1684450200,
    "value": 64742.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 947,
    "Unnamed: 0": 1139,
    "time": 1684450500,
    "value": 81875.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 948,
    "Unnamed: 0": 1140,
    "time": 1684450800,
    "value": 32986.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 949,
    "Unnamed: 0": 1141,
    "time": 1684451100,
    "value": 63185.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 950,
    "Unnamed: 0": 1142,
    "time": 1684451400,
    "value": 35447.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 951,
    "Unnamed: 0": 1143,
    "time": 1684451700,
    "value": 24043.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 952,
    "Unnamed: 0": 1144,
    "time": 1684452000,
    "value": 21787.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 953,
    "Unnamed: 0": 1145,
    "time": 1684452300,
    "value": 20530.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 954,
    "Unnamed: 0": 1146,
    "time": 1684452600,
    "value": 47352.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 955,
    "Unnamed: 0": 1147,
    "time": 1684452900,
    "value": 38766.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 956,
    "Unnamed: 0": 1148,
    "time": 1684453200,
    "value": 20774.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 957,
    "Unnamed: 0": 1149,
    "time": 1684453500,
    "value": 29319.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 958,
    "Unnamed: 0": 1150,
    "time": 1684453800,
    "value": 11812.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 959,
    "Unnamed: 0": 1151,
    "time": 1684454100,
    "value": 67622.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 960,
    "Unnamed: 0": 1344,
    "time": 1684483200,
    "value": 8238.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 961,
    "Unnamed: 0": 1345,
    "time": 1684483500,
    "value": 4563.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 962,
    "Unnamed: 0": 1346,
    "time": 1684483800,
    "value": 5424.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 963,
    "Unnamed: 0": 1347,
    "time": 1684484100,
    "value": 1981.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 964,
    "Unnamed: 0": 1348,
    "time": 1684484400,
    "value": 2927.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 965,
    "Unnamed: 0": 1349,
    "time": 1684484700,
    "value": 7264.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 966,
    "Unnamed: 0": 1350,
    "time": 1684485000,
    "value": 2689.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 967,
    "Unnamed: 0": 1351,
    "time": 1684485300,
    "value": 2312.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 968,
    "Unnamed: 0": 1352,
    "time": 1684485600,
    "value": 3008.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 969,
    "Unnamed: 0": 1353,
    "time": 1684485900,
    "value": 2034.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 970,
    "Unnamed: 0": 1354,
    "time": 1684486200,
    "value": 1289.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 971,
    "Unnamed: 0": 1355,
    "time": 1684486500,
    "value": 2796.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 972,
    "Unnamed: 0": 1356,
    "time": 1684486800,
    "value": 839.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 973,
    "Unnamed: 0": 1357,
    "time": 1684487100,
    "value": 991.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 974,
    "Unnamed: 0": 1358,
    "time": 1684487400,
    "value": 1049.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 975,
    "Unnamed: 0": 1359,
    "time": 1684487700,
    "value": 238.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 976,
    "Unnamed: 0": 1360,
    "time": 1684488000,
    "value": 8022.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 977,
    "Unnamed: 0": 1361,
    "time": 1684488300,
    "value": 1055.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 978,
    "Unnamed: 0": 1362,
    "time": 1684488600,
    "value": 798.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 979,
    "Unnamed: 0": 1363,
    "time": 1684488900,
    "value": 900.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 980,
    "Unnamed: 0": 1364,
    "time": 1684489200,
    "value": 698.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 981,
    "Unnamed: 0": 1365,
    "time": 1684489500,
    "value": 1974.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 982,
    "Unnamed: 0": 1366,
    "time": 1684489800,
    "value": 400.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 983,
    "Unnamed: 0": 1367,
    "time": 1684490100,
    "value": 100.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 984,
    "Unnamed: 0": 1368,
    "time": 1684490400,
    "value": 648.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 985,
    "Unnamed: 0": 1369,
    "time": 1684490700,
    "value": 2054.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 986,
    "Unnamed: 0": 1370,
    "time": 1684491000,
    "value": 212.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 987,
    "Unnamed: 0": 1371,
    "time": 1684491300,
    "value": 7212.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 988,
    "Unnamed: 0": 1372,
    "time": 1684491600,
    "value": 1727.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 989,
    "Unnamed: 0": 1373,
    "time": 1684491900,
    "value": 1219.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 990,
    "Unnamed: 0": 1374,
    "time": 1684492200,
    "value": 3080.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 991,
    "Unnamed: 0": 1375,
    "time": 1684492500,
    "value": 2987.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 992,
    "Unnamed: 0": 1376,
    "time": 1684492800,
    "value": 6241.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 993,
    "Unnamed: 0": 1377,
    "time": 1684493100,
    "value": 8171.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 994,
    "Unnamed: 0": 1378,
    "time": 1684493400,
    "value": 3498.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 995,
    "Unnamed: 0": 1379,
    "time": 1684493700,
    "value": 13841.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 996,
    "Unnamed: 0": 1380,
    "time": 1684494000,
    "value": 45000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 997,
    "Unnamed: 0": 1381,
    "time": 1684494300,
    "value": 14973.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 998,
    "Unnamed: 0": 1382,
    "time": 1684494600,
    "value": 14507.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 999,
    "Unnamed: 0": 1383,
    "time": 1684494900,
    "value": 12653.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1000,
    "Unnamed: 0": 1384,
    "time": 1684495200,
    "value": 14985.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1001,
    "Unnamed: 0": 1385,
    "time": 1684495500,
    "value": 13948.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1002,
    "Unnamed: 0": 1386,
    "time": 1684495800,
    "value": 14885.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1003,
    "Unnamed: 0": 1387,
    "time": 1684496100,
    "value": 10830.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1004,
    "Unnamed: 0": 1388,
    "time": 1684496400,
    "value": 12375.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1005,
    "Unnamed: 0": 1389,
    "time": 1684496700,
    "value": 35635.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1006,
    "Unnamed: 0": 1390,
    "time": 1684497000,
    "value": 11596.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1007,
    "Unnamed: 0": 1391,
    "time": 1684497300,
    "value": 5392.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1008,
    "Unnamed: 0": 1392,
    "time": 1684497600,
    "value": 202208.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1009,
    "Unnamed: 0": 1393,
    "time": 1684497900,
    "value": 38900.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1010,
    "Unnamed: 0": 1394,
    "time": 1684498200,
    "value": 21844.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1011,
    "Unnamed: 0": 1395,
    "time": 1684498500,
    "value": 31949.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1012,
    "Unnamed: 0": 1396,
    "time": 1684498800,
    "value": 41630.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1013,
    "Unnamed: 0": 1397,
    "time": 1684499100,
    "value": 23618.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1014,
    "Unnamed: 0": 1398,
    "time": 1684499400,
    "value": 25369.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1015,
    "Unnamed: 0": 1399,
    "time": 1684499700,
    "value": 27068.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1016,
    "Unnamed: 0": 1400,
    "time": 1684500000,
    "value": 31161.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1017,
    "Unnamed: 0": 1401,
    "time": 1684500300,
    "value": 41654.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1018,
    "Unnamed: 0": 1402,
    "time": 1684500600,
    "value": 19817.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1019,
    "Unnamed: 0": 1403,
    "time": 1684500900,
    "value": 72778.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1020,
    "Unnamed: 0": 1404,
    "time": 1684501200,
    "value": 34061.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1021,
    "Unnamed: 0": 1405,
    "time": 1684501500,
    "value": 39269.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1022,
    "Unnamed: 0": 1406,
    "time": 1684501800,
    "value": 50043.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1023,
    "Unnamed: 0": 1407,
    "time": 1684502100,
    "value": 33524.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1024,
    "Unnamed: 0": 1408,
    "time": 1684502400,
    "value": 34688.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1025,
    "Unnamed: 0": 1409,
    "time": 1684502700,
    "value": 100788.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1026,
    "Unnamed: 0": 1410,
    "time": 1684503000,
    "value": 3748609.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1027,
    "Unnamed: 0": 1411,
    "time": 1684503300,
    "value": 3402814.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1028,
    "Unnamed: 0": 1412,
    "time": 1684503600,
    "value": 2569120.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1029,
    "Unnamed: 0": 1413,
    "time": 1684503900,
    "value": 2540526.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1030,
    "Unnamed: 0": 1414,
    "time": 1684504200,
    "value": 1804875.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1031,
    "Unnamed: 0": 1415,
    "time": 1684504500,
    "value": 2080936.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1032,
    "Unnamed: 0": 1416,
    "time": 1684504800,
    "value": 2109541.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1033,
    "Unnamed: 0": 1417,
    "time": 1684505100,
    "value": 2837666.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1034,
    "Unnamed: 0": 1418,
    "time": 1684505400,
    "value": 2218580.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1035,
    "Unnamed: 0": 1419,
    "time": 1684505700,
    "value": 2138167.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1036,
    "Unnamed: 0": 1420,
    "time": 1684506000,
    "value": 2616579.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1037,
    "Unnamed: 0": 1421,
    "time": 1684506300,
    "value": 2519265.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1038,
    "Unnamed: 0": 1422,
    "time": 1684506600,
    "value": 3069846.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1039,
    "Unnamed: 0": 1423,
    "time": 1684506900,
    "value": 2072413.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1040,
    "Unnamed: 0": 1424,
    "time": 1684507200,
    "value": 1841608.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1041,
    "Unnamed: 0": 1425,
    "time": 1684507500,
    "value": 1587646.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1042,
    "Unnamed: 0": 1426,
    "time": 1684507800,
    "value": 2718764.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1043,
    "Unnamed: 0": 1427,
    "time": 1684508100,
    "value": 1737524.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1044,
    "Unnamed: 0": 1428,
    "time": 1684508400,
    "value": 1523983.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1045,
    "Unnamed: 0": 1429,
    "time": 1684508700,
    "value": 1718579.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1046,
    "Unnamed: 0": 1430,
    "time": 1684509000,
    "value": 1395093.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1047,
    "Unnamed: 0": 1431,
    "time": 1684509300,
    "value": 1771091.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1048,
    "Unnamed: 0": 1432,
    "time": 1684509600,
    "value": 1564628.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1049,
    "Unnamed: 0": 1433,
    "time": 1684509900,
    "value": 1976706.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1050,
    "Unnamed: 0": 1434,
    "time": 1684510200,
    "value": 2399758.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1051,
    "Unnamed: 0": 1435,
    "time": 1684510500,
    "value": 2291510.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1052,
    "Unnamed: 0": 1436,
    "time": 1684510800,
    "value": 1927171.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1053,
    "Unnamed: 0": 1437,
    "time": 1684511100,
    "value": 1970492.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1054,
    "Unnamed: 0": 1438,
    "time": 1684511400,
    "value": 1480439.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1055,
    "Unnamed: 0": 1439,
    "time": 1684511700,
    "value": 1544378.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1056,
    "Unnamed: 0": 1440,
    "time": 1684512000,
    "value": 1444836.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1057,
    "Unnamed: 0": 1441,
    "time": 1684512300,
    "value": 1120301.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1058,
    "Unnamed: 0": 1442,
    "time": 1684512600,
    "value": 1219155.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1059,
    "Unnamed: 0": 1443,
    "time": 1684512900,
    "value": 1373080.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1060,
    "Unnamed: 0": 1444,
    "time": 1684513200,
    "value": 1210275.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1061,
    "Unnamed: 0": 1445,
    "time": 1684513500,
    "value": 1049496.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1062,
    "Unnamed: 0": 1446,
    "time": 1684513800,
    "value": 1456609.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1063,
    "Unnamed: 0": 1447,
    "time": 1684514100,
    "value": 1333331.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1064,
    "Unnamed: 0": 1448,
    "time": 1684514400,
    "value": 864326.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1065,
    "Unnamed: 0": 1449,
    "time": 1684514700,
    "value": 920581.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1066,
    "Unnamed: 0": 1450,
    "time": 1684515000,
    "value": 941203.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1067,
    "Unnamed: 0": 1451,
    "time": 1684515300,
    "value": 1024313.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1068,
    "Unnamed: 0": 1452,
    "time": 1684515600,
    "value": 1311406.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1069,
    "Unnamed: 0": 1453,
    "time": 1684515900,
    "value": 1329561.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1070,
    "Unnamed: 0": 1454,
    "time": 1684516200,
    "value": 888654.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1071,
    "Unnamed: 0": 1455,
    "time": 1684516500,
    "value": 922196.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1072,
    "Unnamed: 0": 1456,
    "time": 1684516800,
    "value": 1113917.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1073,
    "Unnamed: 0": 1457,
    "time": 1684517100,
    "value": 1107579.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1074,
    "Unnamed: 0": 1458,
    "time": 1684517400,
    "value": 868574.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1075,
    "Unnamed: 0": 1459,
    "time": 1684517700,
    "value": 1039055.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1076,
    "Unnamed: 0": 1460,
    "time": 1684518000,
    "value": 868620.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1077,
    "Unnamed: 0": 1461,
    "time": 1684518300,
    "value": 766527.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1078,
    "Unnamed: 0": 1462,
    "time": 1684518600,
    "value": 780675.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1079,
    "Unnamed: 0": 1463,
    "time": 1684518900,
    "value": 681926.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1080,
    "Unnamed: 0": 1464,
    "time": 1684519200,
    "value": 944804.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1081,
    "Unnamed: 0": 1465,
    "time": 1684519500,
    "value": 641722.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1082,
    "Unnamed: 0": 1466,
    "time": 1684519800,
    "value": 602257.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1083,
    "Unnamed: 0": 1467,
    "time": 1684520100,
    "value": 1095696.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1084,
    "Unnamed: 0": 1468,
    "time": 1684520400,
    "value": 847671.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1085,
    "Unnamed: 0": 1469,
    "time": 1684520700,
    "value": 932456.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1086,
    "Unnamed: 0": 1470,
    "time": 1684521000,
    "value": 1231696.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1087,
    "Unnamed: 0": 1471,
    "time": 1684521300,
    "value": 841476.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1088,
    "Unnamed: 0": 1472,
    "time": 1684521600,
    "value": 1319758.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1089,
    "Unnamed: 0": 1473,
    "time": 1684521900,
    "value": 788237.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1090,
    "Unnamed: 0": 1474,
    "time": 1684522200,
    "value": 784896.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1091,
    "Unnamed: 0": 1475,
    "time": 1684522500,
    "value": 648186.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1092,
    "Unnamed: 0": 1476,
    "time": 1684522800,
    "value": 666866.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1093,
    "Unnamed: 0": 1477,
    "time": 1684523100,
    "value": 688147.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1094,
    "Unnamed: 0": 1478,
    "time": 1684523400,
    "value": 723754.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1095,
    "Unnamed: 0": 1479,
    "time": 1684523700,
    "value": 1023234.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1096,
    "Unnamed: 0": 1480,
    "time": 1684524000,
    "value": 671651.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1097,
    "Unnamed: 0": 1481,
    "time": 1684524300,
    "value": 731655.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1098,
    "Unnamed: 0": 1482,
    "time": 1684524600,
    "value": 619922.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1099,
    "Unnamed: 0": 1483,
    "time": 1684524900,
    "value": 746590.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1100,
    "Unnamed: 0": 1484,
    "time": 1684525200,
    "value": 774208.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1101,
    "Unnamed: 0": 1485,
    "time": 1684525500,
    "value": 1103745.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1102,
    "Unnamed: 0": 1486,
    "time": 1684525800,
    "value": 1101989.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1103,
    "Unnamed: 0": 1487,
    "time": 1684526100,
    "value": 2481817.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1104,
    "Unnamed: 0": 1488,
    "time": 1684526400,
    "value": 1828754.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1105,
    "Unnamed: 0": 1489,
    "time": 1684526700,
    "value": 122120.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1106,
    "Unnamed: 0": 1490,
    "time": 1684527000,
    "value": 40399.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1107,
    "Unnamed: 0": 1491,
    "time": 1684527300,
    "value": 47062.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1108,
    "Unnamed: 0": 1492,
    "time": 1684527600,
    "value": 15238.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1109,
    "Unnamed: 0": 1493,
    "time": 1684527900,
    "value": 36255.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1110,
    "Unnamed: 0": 1494,
    "time": 1684528200,
    "value": 54163.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1111,
    "Unnamed: 0": 1495,
    "time": 1684528500,
    "value": 17206.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1112,
    "Unnamed: 0": 1496,
    "time": 1684528800,
    "value": 66182.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1113,
    "Unnamed: 0": 1497,
    "time": 1684529100,
    "value": 22559.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1114,
    "Unnamed: 0": 1498,
    "time": 1684529400,
    "value": 20939.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1115,
    "Unnamed: 0": 1499,
    "time": 1684529700,
    "value": 13955.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1116,
    "Unnamed: 0": 1500,
    "time": 1684530000,
    "value": 18204.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1117,
    "Unnamed: 0": 1501,
    "time": 1684530300,
    "value": 7540.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1118,
    "Unnamed: 0": 1502,
    "time": 1684530600,
    "value": 3459.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1119,
    "Unnamed: 0": 1503,
    "time": 1684530900,
    "value": 1605.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1120,
    "Unnamed: 0": 1504,
    "time": 1684531200,
    "value": 7755.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1121,
    "Unnamed: 0": 1505,
    "time": 1684531500,
    "value": 10989.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1122,
    "Unnamed: 0": 1506,
    "time": 1684531800,
    "value": 2389.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1123,
    "Unnamed: 0": 1507,
    "time": 1684532100,
    "value": 4968.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1124,
    "Unnamed: 0": 1508,
    "time": 1684532400,
    "value": 11766.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1125,
    "Unnamed: 0": 1509,
    "time": 1684532700,
    "value": 16034.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1126,
    "Unnamed: 0": 1510,
    "time": 1684533000,
    "value": 3352.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1127,
    "Unnamed: 0": 1511,
    "time": 1684533300,
    "value": 8246.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1128,
    "Unnamed: 0": 1512,
    "time": 1684533600,
    "value": 2005.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1129,
    "Unnamed: 0": 1513,
    "time": 1684533900,
    "value": 12487.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1130,
    "Unnamed: 0": 1514,
    "time": 1684534200,
    "value": 1399.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1131,
    "Unnamed: 0": 1515,
    "time": 1684534500,
    "value": 7539.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1132,
    "Unnamed: 0": 1516,
    "time": 1684534800,
    "value": 12563.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1133,
    "Unnamed: 0": 1517,
    "time": 1684535100,
    "value": 3170.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1134,
    "Unnamed: 0": 1518,
    "time": 1684535400,
    "value": 3185.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1135,
    "Unnamed: 0": 1519,
    "time": 1684535700,
    "value": 7706.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1136,
    "Unnamed: 0": 1520,
    "time": 1684536000,
    "value": 1506.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1137,
    "Unnamed: 0": 1521,
    "time": 1684536300,
    "value": 7994.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1138,
    "Unnamed: 0": 1522,
    "time": 1684536600,
    "value": 4519.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1139,
    "Unnamed: 0": 1523,
    "time": 1684536900,
    "value": 7456.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1140,
    "Unnamed: 0": 1524,
    "time": 1684537200,
    "value": 6288.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1141,
    "Unnamed: 0": 1525,
    "time": 1684537500,
    "value": 6530.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1142,
    "Unnamed: 0": 1526,
    "time": 1684537800,
    "value": 2957.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1143,
    "Unnamed: 0": 1527,
    "time": 1684538100,
    "value": 4158.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1144,
    "Unnamed: 0": 1528,
    "time": 1684538400,
    "value": 4882.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1145,
    "Unnamed: 0": 1529,
    "time": 1684538700,
    "value": 3002.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1146,
    "Unnamed: 0": 1530,
    "time": 1684539000,
    "value": 2794.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1147,
    "Unnamed: 0": 1531,
    "time": 1684539300,
    "value": 4024.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1148,
    "Unnamed: 0": 1532,
    "time": 1684539600,
    "value": 7256.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1149,
    "Unnamed: 0": 1533,
    "time": 1684539900,
    "value": 4019.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1150,
    "Unnamed: 0": 1534,
    "time": 1684540200,
    "value": 9959.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1151,
    "Unnamed: 0": 1535,
    "time": 1684540500,
    "value": 19560.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1152,
    "Unnamed: 0": 1536,
    "time": 1684828800,
    "value": 13713.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1153,
    "Unnamed: 0": 1537,
    "time": 1684829100,
    "value": 9895.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1154,
    "Unnamed: 0": 1538,
    "time": 1684829400,
    "value": 19496.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1155,
    "Unnamed: 0": 1539,
    "time": 1684829700,
    "value": 8960.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1156,
    "Unnamed: 0": 1540,
    "time": 1684830000,
    "value": 5900.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1157,
    "Unnamed: 0": 1541,
    "time": 1684830300,
    "value": 3660.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1158,
    "Unnamed: 0": 1542,
    "time": 1684830600,
    "value": 1615.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1159,
    "Unnamed: 0": 1543,
    "time": 1684830900,
    "value": 2604.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1160,
    "Unnamed: 0": 1544,
    "time": 1684831200,
    "value": 2087.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1161,
    "Unnamed: 0": 1545,
    "time": 1684831500,
    "value": 3338.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1162,
    "Unnamed: 0": 1546,
    "time": 1684831800,
    "value": 1343.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1163,
    "Unnamed: 0": 1547,
    "time": 1684832100,
    "value": 1296.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1164,
    "Unnamed: 0": 1548,
    "time": 1684832400,
    "value": 4610.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1165,
    "Unnamed: 0": 1549,
    "time": 1684832700,
    "value": 512.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1166,
    "Unnamed: 0": 1550,
    "time": 1684833000,
    "value": 1789.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1167,
    "Unnamed: 0": 1551,
    "time": 1684833300,
    "value": 1184.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1168,
    "Unnamed: 0": 1552,
    "time": 1684833600,
    "value": 4169.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1169,
    "Unnamed: 0": 1553,
    "time": 1684833900,
    "value": 1790.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1170,
    "Unnamed: 0": 1554,
    "time": 1684834200,
    "value": 1219.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1171,
    "Unnamed: 0": 1555,
    "time": 1684834500,
    "value": 1935.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1172,
    "Unnamed: 0": 1556,
    "time": 1684834800,
    "value": 3075.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1173,
    "Unnamed: 0": 1557,
    "time": 1684835100,
    "value": 4681.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1174,
    "Unnamed: 0": 1558,
    "time": 1684835400,
    "value": 2603.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1175,
    "Unnamed: 0": 1559,
    "time": 1684835700,
    "value": 796.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1176,
    "Unnamed: 0": 1560,
    "time": 1684836000,
    "value": 2419.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1177,
    "Unnamed: 0": 1561,
    "time": 1684836300,
    "value": 2960.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1178,
    "Unnamed: 0": 1562,
    "time": 1684836600,
    "value": 2384.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1179,
    "Unnamed: 0": 1563,
    "time": 1684836900,
    "value": 853.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1180,
    "Unnamed: 0": 1564,
    "time": 1684837200,
    "value": 1216.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1181,
    "Unnamed: 0": 1565,
    "time": 1684837500,
    "value": 2971.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1182,
    "Unnamed: 0": 1566,
    "time": 1684837800,
    "value": 6059.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1183,
    "Unnamed: 0": 1567,
    "time": 1684838100,
    "value": 6066.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1184,
    "Unnamed: 0": 1568,
    "time": 1684838400,
    "value": 2906.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1185,
    "Unnamed: 0": 1569,
    "time": 1684838700,
    "value": 4777.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1186,
    "Unnamed: 0": 1570,
    "time": 1684839000,
    "value": 2304.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1187,
    "Unnamed: 0": 1571,
    "time": 1684839300,
    "value": 4307.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1188,
    "Unnamed: 0": 1572,
    "time": 1684839600,
    "value": 24958.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1189,
    "Unnamed: 0": 1573,
    "time": 1684839900,
    "value": 19210.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1190,
    "Unnamed: 0": 1574,
    "time": 1684840200,
    "value": 36376.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1191,
    "Unnamed: 0": 1575,
    "time": 1684840500,
    "value": 11290.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1192,
    "Unnamed: 0": 1576,
    "time": 1684840800,
    "value": 6514.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1193,
    "Unnamed: 0": 1577,
    "time": 1684841100,
    "value": 12799.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1194,
    "Unnamed: 0": 1578,
    "time": 1684841400,
    "value": 16527.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1195,
    "Unnamed: 0": 1579,
    "time": 1684841700,
    "value": 11334.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1196,
    "Unnamed: 0": 1580,
    "time": 1684842000,
    "value": 10455.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1197,
    "Unnamed: 0": 1581,
    "time": 1684842300,
    "value": 13567.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1198,
    "Unnamed: 0": 1582,
    "time": 1684842600,
    "value": 26510.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1199,
    "Unnamed: 0": 1583,
    "time": 1684842900,
    "value": 16182.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1200,
    "Unnamed: 0": 1584,
    "time": 1684843200,
    "value": 206298.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1201,
    "Unnamed: 0": 1585,
    "time": 1684843500,
    "value": 37381.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1202,
    "Unnamed: 0": 1586,
    "time": 1684843800,
    "value": 25854.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1203,
    "Unnamed: 0": 1587,
    "time": 1684844100,
    "value": 25108.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1204,
    "Unnamed: 0": 1588,
    "time": 1684844400,
    "value": 12349.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1205,
    "Unnamed: 0": 1589,
    "time": 1684844700,
    "value": 13246.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1206,
    "Unnamed: 0": 1590,
    "time": 1684845000,
    "value": 37676.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1207,
    "Unnamed: 0": 1591,
    "time": 1684845300,
    "value": 38517.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1208,
    "Unnamed: 0": 1592,
    "time": 1684845600,
    "value": 46866.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1209,
    "Unnamed: 0": 1593,
    "time": 1684845900,
    "value": 50407.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1210,
    "Unnamed: 0": 1594,
    "time": 1684846200,
    "value": 53178.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1211,
    "Unnamed: 0": 1595,
    "time": 1684846500,
    "value": 110903.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1212,
    "Unnamed: 0": 1596,
    "time": 1684846800,
    "value": 68367.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1213,
    "Unnamed: 0": 1597,
    "time": 1684847100,
    "value": 52908.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1214,
    "Unnamed: 0": 1598,
    "time": 1684847400,
    "value": 98095.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1215,
    "Unnamed: 0": 1599,
    "time": 1684847700,
    "value": 63797.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1216,
    "Unnamed: 0": 1600,
    "time": 1684848000,
    "value": 87492.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1217,
    "Unnamed: 0": 1601,
    "time": 1684848300,
    "value": 72388.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1218,
    "Unnamed: 0": 1602,
    "time": 1684848600,
    "value": 3707942.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1219,
    "Unnamed: 0": 1603,
    "time": 1684848900,
    "value": 3006749.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1220,
    "Unnamed: 0": 1604,
    "time": 1684849200,
    "value": 3149770.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1221,
    "Unnamed: 0": 1605,
    "time": 1684849500,
    "value": 4674401.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1222,
    "Unnamed: 0": 1606,
    "time": 1684849800,
    "value": 3314354.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1223,
    "Unnamed: 0": 1607,
    "time": 1684850100,
    "value": 3183074.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1224,
    "Unnamed: 0": 1608,
    "time": 1684850400,
    "value": 2954660.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1225,
    "Unnamed: 0": 1609,
    "time": 1684850700,
    "value": 2716697.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1226,
    "Unnamed: 0": 1610,
    "time": 1684851000,
    "value": 2076977.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1227,
    "Unnamed: 0": 1611,
    "time": 1684851300,
    "value": 1894819.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1228,
    "Unnamed: 0": 1612,
    "time": 1684851600,
    "value": 1988275.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1229,
    "Unnamed: 0": 1613,
    "time": 1684851900,
    "value": 2023702.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1230,
    "Unnamed: 0": 1614,
    "time": 1684852200,
    "value": 1816462.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1231,
    "Unnamed: 0": 1615,
    "time": 1684852500,
    "value": 2631413.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1232,
    "Unnamed: 0": 1616,
    "time": 1684852800,
    "value": 2502580.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1233,
    "Unnamed: 0": 1617,
    "time": 1684853100,
    "value": 1925409.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1234,
    "Unnamed: 0": 1618,
    "time": 1684853400,
    "value": 1862278.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1235,
    "Unnamed: 0": 1619,
    "time": 1684853700,
    "value": 1480252.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1236,
    "Unnamed: 0": 1620,
    "time": 1684854000,
    "value": 1295629.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1237,
    "Unnamed: 0": 1621,
    "time": 1684854300,
    "value": 1474900.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1238,
    "Unnamed: 0": 1622,
    "time": 1684854600,
    "value": 1387003.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1239,
    "Unnamed: 0": 1623,
    "time": 1684854900,
    "value": 1750880.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1240,
    "Unnamed: 0": 1624,
    "time": 1684855200,
    "value": 1321287.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1241,
    "Unnamed: 0": 1625,
    "time": 1684855500,
    "value": 1490544.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1242,
    "Unnamed: 0": 1626,
    "time": 1684855800,
    "value": 900125.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1243,
    "Unnamed: 0": 1627,
    "time": 1684856100,
    "value": 1735395.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1244,
    "Unnamed: 0": 1628,
    "time": 1684856400,
    "value": 1199575.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1245,
    "Unnamed: 0": 1629,
    "time": 1684856700,
    "value": 1758196.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1246,
    "Unnamed: 0": 1630,
    "time": 1684857000,
    "value": 1758380.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1247,
    "Unnamed: 0": 1631,
    "time": 1684857300,
    "value": 1700565.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1248,
    "Unnamed: 0": 1632,
    "time": 1684857600,
    "value": 1274404.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1249,
    "Unnamed: 0": 1633,
    "time": 1684857900,
    "value": 1367774.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1250,
    "Unnamed: 0": 1634,
    "time": 1684858200,
    "value": 1202054.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1251,
    "Unnamed: 0": 1635,
    "time": 1684858500,
    "value": 1306057.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1252,
    "Unnamed: 0": 1636,
    "time": 1684858800,
    "value": 1010163.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1253,
    "Unnamed: 0": 1637,
    "time": 1684859100,
    "value": 2089114.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1254,
    "Unnamed: 0": 1638,
    "time": 1684859400,
    "value": 2432770.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1255,
    "Unnamed: 0": 1639,
    "time": 1684859700,
    "value": 2447194.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1256,
    "Unnamed: 0": 1640,
    "time": 1684860000,
    "value": 1882756.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1257,
    "Unnamed: 0": 1641,
    "time": 1684860300,
    "value": 1840169.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1258,
    "Unnamed: 0": 1642,
    "time": 1684860600,
    "value": 1780724.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1259,
    "Unnamed: 0": 1643,
    "time": 1684860900,
    "value": 1827817.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1260,
    "Unnamed: 0": 1644,
    "time": 1684861200,
    "value": 1204065.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1261,
    "Unnamed: 0": 1645,
    "time": 1684861500,
    "value": 1796417.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1262,
    "Unnamed: 0": 1646,
    "time": 1684861800,
    "value": 1440464.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1263,
    "Unnamed: 0": 1647,
    "time": 1684862100,
    "value": 1561169.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1264,
    "Unnamed: 0": 1648,
    "time": 1684862400,
    "value": 1094704.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1265,
    "Unnamed: 0": 1649,
    "time": 1684862700,
    "value": 1785950.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1266,
    "Unnamed: 0": 1650,
    "time": 1684863000,
    "value": 1721133.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1267,
    "Unnamed: 0": 1651,
    "time": 1684863300,
    "value": 1190708.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1268,
    "Unnamed: 0": 1652,
    "time": 1684863600,
    "value": 1101317.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1269,
    "Unnamed: 0": 1653,
    "time": 1684863900,
    "value": 1301273.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1270,
    "Unnamed: 0": 1654,
    "time": 1684864200,
    "value": 1615068.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1271,
    "Unnamed: 0": 1655,
    "time": 1684864500,
    "value": 939087.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1272,
    "Unnamed: 0": 1656,
    "time": 1684864800,
    "value": 1234458.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1273,
    "Unnamed: 0": 1657,
    "time": 1684865100,
    "value": 1281140.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1274,
    "Unnamed: 0": 1658,
    "time": 1684865400,
    "value": 1150430.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1275,
    "Unnamed: 0": 1659,
    "time": 1684865700,
    "value": 1205067.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1276,
    "Unnamed: 0": 1660,
    "time": 1684866000,
    "value": 1891952.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1277,
    "Unnamed: 0": 1661,
    "time": 1684866300,
    "value": 1376028.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1278,
    "Unnamed: 0": 1662,
    "time": 1684866600,
    "value": 1182627.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1279,
    "Unnamed: 0": 1663,
    "time": 1684866900,
    "value": 1330260.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1280,
    "Unnamed: 0": 1664,
    "time": 1684867200,
    "value": 1113607.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1281,
    "Unnamed: 0": 1665,
    "time": 1684867500,
    "value": 1115850.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1282,
    "Unnamed: 0": 1666,
    "time": 1684867800,
    "value": 1066188.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1283,
    "Unnamed: 0": 1667,
    "time": 1684868100,
    "value": 759300.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1284,
    "Unnamed: 0": 1668,
    "time": 1684868400,
    "value": 1028922.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1285,
    "Unnamed: 0": 1669,
    "time": 1684868700,
    "value": 1500453.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1286,
    "Unnamed: 0": 1670,
    "time": 1684869000,
    "value": 1282585.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1287,
    "Unnamed: 0": 1671,
    "time": 1684869300,
    "value": 1680906.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1288,
    "Unnamed: 0": 1672,
    "time": 1684869600,
    "value": 1499299.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1289,
    "Unnamed: 0": 1673,
    "time": 1684869900,
    "value": 1283853.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1290,
    "Unnamed: 0": 1674,
    "time": 1684870200,
    "value": 1058050.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1291,
    "Unnamed: 0": 1675,
    "time": 1684870500,
    "value": 856440.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1292,
    "Unnamed: 0": 1676,
    "time": 1684870800,
    "value": 971895.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1293,
    "Unnamed: 0": 1677,
    "time": 1684871100,
    "value": 1127329.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1294,
    "Unnamed: 0": 1678,
    "time": 1684871400,
    "value": 1343915.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1295,
    "Unnamed: 0": 1679,
    "time": 1684871700,
    "value": 1443980.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1296,
    "Unnamed: 0": 1680,
    "time": 1684872000,
    "value": 1368282.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1297,
    "Unnamed: 0": 1681,
    "time": 1684872300,
    "value": 75176.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1298,
    "Unnamed: 0": 1682,
    "time": 1684872600,
    "value": 30348.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1299,
    "Unnamed: 0": 1683,
    "time": 1684872900,
    "value": 24718.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1300,
    "Unnamed: 0": 1684,
    "time": 1684873200,
    "value": 26816.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1301,
    "Unnamed: 0": 1685,
    "time": 1684873500,
    "value": 19914.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1302,
    "Unnamed: 0": 1686,
    "time": 1684873800,
    "value": 19620.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1303,
    "Unnamed: 0": 1687,
    "time": 1684874100,
    "value": 20649.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1304,
    "Unnamed: 0": 1688,
    "time": 1684874400,
    "value": 12343.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1305,
    "Unnamed: 0": 1689,
    "time": 1684874700,
    "value": 11066.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1306,
    "Unnamed: 0": 1690,
    "time": 1684875000,
    "value": 27934.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1307,
    "Unnamed: 0": 1691,
    "time": 1684875300,
    "value": 16509.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1308,
    "Unnamed: 0": 1692,
    "time": 1684875600,
    "value": 8202.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1309,
    "Unnamed: 0": 1693,
    "time": 1684875900,
    "value": 12411.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1310,
    "Unnamed: 0": 1694,
    "time": 1684876200,
    "value": 19632.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1311,
    "Unnamed: 0": 1695,
    "time": 1684876500,
    "value": 59358.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1312,
    "Unnamed: 0": 1696,
    "time": 1684876800,
    "value": 27102.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1313,
    "Unnamed: 0": 1697,
    "time": 1684877100,
    "value": 12499.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1314,
    "Unnamed: 0": 1698,
    "time": 1684877400,
    "value": 20270.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1315,
    "Unnamed: 0": 1699,
    "time": 1684877700,
    "value": 10034.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1316,
    "Unnamed: 0": 1700,
    "time": 1684878000,
    "value": 13171.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1317,
    "Unnamed: 0": 1701,
    "time": 1684878300,
    "value": 10909.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1318,
    "Unnamed: 0": 1702,
    "time": 1684878600,
    "value": 10772.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1319,
    "Unnamed: 0": 1703,
    "time": 1684878900,
    "value": 13868.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1320,
    "Unnamed: 0": 1704,
    "time": 1684879200,
    "value": 19796.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1321,
    "Unnamed: 0": 1705,
    "time": 1684879500,
    "value": 15974.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1322,
    "Unnamed: 0": 1706,
    "time": 1684879800,
    "value": 21448.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1323,
    "Unnamed: 0": 1707,
    "time": 1684880100,
    "value": 6536.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1324,
    "Unnamed: 0": 1708,
    "time": 1684880400,
    "value": 6013.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1325,
    "Unnamed: 0": 1709,
    "time": 1684880700,
    "value": 5531.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1326,
    "Unnamed: 0": 1710,
    "time": 1684881000,
    "value": 11186.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1327,
    "Unnamed: 0": 1711,
    "time": 1684881300,
    "value": 9857.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1328,
    "Unnamed: 0": 1712,
    "time": 1684881600,
    "value": 7265.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1329,
    "Unnamed: 0": 1713,
    "time": 1684881900,
    "value": 8128.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1330,
    "Unnamed: 0": 1714,
    "time": 1684882200,
    "value": 10599.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1331,
    "Unnamed: 0": 1715,
    "time": 1684882500,
    "value": 7601.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1332,
    "Unnamed: 0": 1716,
    "time": 1684882800,
    "value": 15021.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1333,
    "Unnamed: 0": 1717,
    "time": 1684883100,
    "value": 7737.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1334,
    "Unnamed: 0": 1718,
    "time": 1684883400,
    "value": 13151.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1335,
    "Unnamed: 0": 1719,
    "time": 1684883700,
    "value": 10107.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1336,
    "Unnamed: 0": 1720,
    "time": 1684884000,
    "value": 7020.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1337,
    "Unnamed: 0": 1721,
    "time": 1684884300,
    "value": 7698.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1338,
    "Unnamed: 0": 1722,
    "time": 1684884600,
    "value": 12289.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1339,
    "Unnamed: 0": 1723,
    "time": 1684884900,
    "value": 15144.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1340,
    "Unnamed: 0": 1724,
    "time": 1684885200,
    "value": 8702.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1341,
    "Unnamed: 0": 1725,
    "time": 1684885500,
    "value": 34794.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1342,
    "Unnamed: 0": 1726,
    "time": 1684885800,
    "value": 22556.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1343,
    "Unnamed: 0": 1727,
    "time": 1684886100,
    "value": 35029.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1344,
    "Unnamed: 0": 1728,
    "time": 1684915200,
    "value": 13551.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1345,
    "Unnamed: 0": 1729,
    "time": 1684915500,
    "value": 11095.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1346,
    "Unnamed: 0": 1730,
    "time": 1684915800,
    "value": 25690.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1347,
    "Unnamed: 0": 1731,
    "time": 1684916100,
    "value": 17514.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1348,
    "Unnamed: 0": 1732,
    "time": 1684916400,
    "value": 7732.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1349,
    "Unnamed: 0": 1733,
    "time": 1684916700,
    "value": 5405.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1350,
    "Unnamed: 0": 1734,
    "time": 1684917000,
    "value": 7373.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1351,
    "Unnamed: 0": 1735,
    "time": 1684917300,
    "value": 7639.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1352,
    "Unnamed: 0": 1736,
    "time": 1684917600,
    "value": 3653.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1353,
    "Unnamed: 0": 1737,
    "time": 1684917900,
    "value": 5846.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1354,
    "Unnamed: 0": 1738,
    "time": 1684918200,
    "value": 1148.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1355,
    "Unnamed: 0": 1739,
    "time": 1684918500,
    "value": 6490.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1356,
    "Unnamed: 0": 1740,
    "time": 1684918800,
    "value": 3002.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1357,
    "Unnamed: 0": 1741,
    "time": 1684919100,
    "value": 2541.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1358,
    "Unnamed: 0": 1742,
    "time": 1684919400,
    "value": 7534.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1359,
    "Unnamed: 0": 1743,
    "time": 1684919700,
    "value": 4135.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1360,
    "Unnamed: 0": 1744,
    "time": 1684920000,
    "value": 1356.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1361,
    "Unnamed: 0": 1745,
    "time": 1684920300,
    "value": 5597.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1362,
    "Unnamed: 0": 1746,
    "time": 1684920600,
    "value": 1854.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1363,
    "Unnamed: 0": 1747,
    "time": 1684920900,
    "value": 783.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1364,
    "Unnamed: 0": 1748,
    "time": 1684921200,
    "value": 1591.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1365,
    "Unnamed: 0": 1749,
    "time": 1684921500,
    "value": 3337.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1366,
    "Unnamed: 0": 1750,
    "time": 1684921800,
    "value": 7586.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1367,
    "Unnamed: 0": 1751,
    "time": 1684922100,
    "value": 1918.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1368,
    "Unnamed: 0": 1752,
    "time": 1684922400,
    "value": 2218.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1369,
    "Unnamed: 0": 1753,
    "time": 1684922700,
    "value": 4354.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1370,
    "Unnamed: 0": 1754,
    "time": 1684923000,
    "value": 8080.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1371,
    "Unnamed: 0": 1755,
    "time": 1684923300,
    "value": 8766.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1372,
    "Unnamed: 0": 1756,
    "time": 1684923600,
    "value": 5527.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1373,
    "Unnamed: 0": 1757,
    "time": 1684923900,
    "value": 8922.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1374,
    "Unnamed: 0": 1758,
    "time": 1684924200,
    "value": 2401.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1375,
    "Unnamed: 0": 1759,
    "time": 1684924500,
    "value": 8461.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1376,
    "Unnamed: 0": 1760,
    "time": 1684924800,
    "value": 3944.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1377,
    "Unnamed: 0": 1761,
    "time": 1684925100,
    "value": 11485.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1378,
    "Unnamed: 0": 1762,
    "time": 1684925400,
    "value": 1740.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1379,
    "Unnamed: 0": 1763,
    "time": 1684925700,
    "value": 7792.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1380,
    "Unnamed: 0": 1764,
    "time": 1684926000,
    "value": 51146.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1381,
    "Unnamed: 0": 1765,
    "time": 1684926300,
    "value": 45820.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1382,
    "Unnamed: 0": 1766,
    "time": 1684926600,
    "value": 32804.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1383,
    "Unnamed: 0": 1767,
    "time": 1684926900,
    "value": 18214.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1384,
    "Unnamed: 0": 1768,
    "time": 1684927200,
    "value": 9875.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1385,
    "Unnamed: 0": 1769,
    "time": 1684927500,
    "value": 27057.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1386,
    "Unnamed: 0": 1770,
    "time": 1684927800,
    "value": 11179.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1387,
    "Unnamed: 0": 1771,
    "time": 1684928100,
    "value": 16584.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1388,
    "Unnamed: 0": 1772,
    "time": 1684928400,
    "value": 24977.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1389,
    "Unnamed: 0": 1773,
    "time": 1684928700,
    "value": 5016.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1390,
    "Unnamed: 0": 1774,
    "time": 1684929000,
    "value": 13711.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1391,
    "Unnamed: 0": 1775,
    "time": 1684929300,
    "value": 7094.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1392,
    "Unnamed: 0": 1776,
    "time": 1684929600,
    "value": 205138.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1393,
    "Unnamed: 0": 1777,
    "time": 1684929900,
    "value": 23378.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1394,
    "Unnamed: 0": 1778,
    "time": 1684930200,
    "value": 76283.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1395,
    "Unnamed: 0": 1779,
    "time": 1684930500,
    "value": 34668.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1396,
    "Unnamed: 0": 1780,
    "time": 1684930800,
    "value": 22915.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1397,
    "Unnamed: 0": 1781,
    "time": 1684931100,
    "value": 29262.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1398,
    "Unnamed: 0": 1782,
    "time": 1684931400,
    "value": 56621.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1399,
    "Unnamed: 0": 1783,
    "time": 1684931700,
    "value": 58692.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1400,
    "Unnamed: 0": 1784,
    "time": 1684932000,
    "value": 41804.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1401,
    "Unnamed: 0": 1785,
    "time": 1684932300,
    "value": 46483.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1402,
    "Unnamed: 0": 1786,
    "time": 1684932600,
    "value": 43520.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1403,
    "Unnamed: 0": 1787,
    "time": 1684932900,
    "value": 34306.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1404,
    "Unnamed: 0": 1788,
    "time": 1684933200,
    "value": 55127.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1405,
    "Unnamed: 0": 1789,
    "time": 1684933500,
    "value": 26989.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1406,
    "Unnamed: 0": 1790,
    "time": 1684933800,
    "value": 51559.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1407,
    "Unnamed: 0": 1791,
    "time": 1684934100,
    "value": 79233.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1408,
    "Unnamed: 0": 1792,
    "time": 1684934400,
    "value": 75077.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1409,
    "Unnamed: 0": 1793,
    "time": 1684934700,
    "value": 102134.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1410,
    "Unnamed: 0": 1794,
    "time": 1684935000,
    "value": 4459857.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1411,
    "Unnamed: 0": 1795,
    "time": 1684935300,
    "value": 2735937.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1412,
    "Unnamed: 0": 1796,
    "time": 1684935600,
    "value": 2611681.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1413,
    "Unnamed: 0": 1797,
    "time": 1684935900,
    "value": 3307947.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1414,
    "Unnamed: 0": 1798,
    "time": 1684936200,
    "value": 3591803.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1415,
    "Unnamed: 0": 1799,
    "time": 1684936500,
    "value": 2781973.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1416,
    "Unnamed: 0": 1800,
    "time": 1684936800,
    "value": 717301.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1417,
    "Unnamed: 0": 1801,
    "time": 1685001600,
    "value": 10166.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1418,
    "Unnamed: 0": 1802,
    "time": 1685001900,
    "value": 3119.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1419,
    "Unnamed: 0": 1803,
    "time": 1685002200,
    "value": 3679.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1420,
    "Unnamed: 0": 1804,
    "time": 1685002500,
    "value": 4922.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1421,
    "Unnamed: 0": 1805,
    "time": 1685002800,
    "value": 4424.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1422,
    "Unnamed: 0": 1806,
    "time": 1685003100,
    "value": 2097.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1423,
    "Unnamed: 0": 1807,
    "time": 1685003400,
    "value": 4506.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1424,
    "Unnamed: 0": 1808,
    "time": 1685003700,
    "value": 1704.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1425,
    "Unnamed: 0": 1809,
    "time": 1685004000,
    "value": 1306.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1426,
    "Unnamed: 0": 1810,
    "time": 1685004300,
    "value": 2041.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1427,
    "Unnamed: 0": 1811,
    "time": 1685004600,
    "value": 3298.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1428,
    "Unnamed: 0": 1812,
    "time": 1685004900,
    "value": 14844.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1429,
    "Unnamed: 0": 1813,
    "time": 1685005200,
    "value": 1635.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1430,
    "Unnamed: 0": 1814,
    "time": 1685005500,
    "value": 3536.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1431,
    "Unnamed: 0": 1815,
    "time": 1685005800,
    "value": 1789.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1432,
    "Unnamed: 0": 1816,
    "time": 1685006100,
    "value": 974.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1433,
    "Unnamed: 0": 1817,
    "time": 1685006400,
    "value": 4225.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1434,
    "Unnamed: 0": 1818,
    "time": 1685006700,
    "value": 2743.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1435,
    "Unnamed: 0": 1819,
    "time": 1685007000,
    "value": 1323.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1436,
    "Unnamed: 0": 1820,
    "time": 1685007300,
    "value": 300.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1437,
    "Unnamed: 0": 1821,
    "time": 1685007600,
    "value": 7832.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1438,
    "Unnamed: 0": 1822,
    "time": 1685007900,
    "value": 4253.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1439,
    "Unnamed: 0": 1823,
    "time": 1685008200,
    "value": 1771.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1440,
    "Unnamed: 0": 1824,
    "time": 1685008500,
    "value": 7448.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1441,
    "Unnamed: 0": 1825,
    "time": 1685008800,
    "value": 3380.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1442,
    "Unnamed: 0": 1826,
    "time": 1685009100,
    "value": 4492.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1443,
    "Unnamed: 0": 1827,
    "time": 1685009400,
    "value": 5176.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1444,
    "Unnamed: 0": 1828,
    "time": 1685009700,
    "value": 1393.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1445,
    "Unnamed: 0": 1829,
    "time": 1685010000,
    "value": 1663.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1446,
    "Unnamed: 0": 1830,
    "time": 1685010300,
    "value": 1001.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1447,
    "Unnamed: 0": 1831,
    "time": 1685010600,
    "value": 1864.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1448,
    "Unnamed: 0": 1832,
    "time": 1685010900,
    "value": 730.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1449,
    "Unnamed: 0": 1833,
    "time": 1685011200,
    "value": 5340.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1450,
    "Unnamed: 0": 1834,
    "time": 1685011500,
    "value": 6148.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1451,
    "Unnamed: 0": 1835,
    "time": 1685011800,
    "value": 3908.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1452,
    "Unnamed: 0": 1836,
    "time": 1685012100,
    "value": 2017.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1453,
    "Unnamed: 0": 1837,
    "time": 1685012400,
    "value": 25054.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1454,
    "Unnamed: 0": 1838,
    "time": 1685012700,
    "value": 20886.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1455,
    "Unnamed: 0": 1839,
    "time": 1685013000,
    "value": 18066.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1456,
    "Unnamed: 0": 1840,
    "time": 1685013300,
    "value": 7127.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1457,
    "Unnamed: 0": 1841,
    "time": 1685013600,
    "value": 8978.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1458,
    "Unnamed: 0": 1842,
    "time": 1685013900,
    "value": 8199.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1459,
    "Unnamed: 0": 1843,
    "time": 1685014200,
    "value": 12923.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1460,
    "Unnamed: 0": 1844,
    "time": 1685014500,
    "value": 4964.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1461,
    "Unnamed: 0": 1845,
    "time": 1685014800,
    "value": 15479.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1462,
    "Unnamed: 0": 1846,
    "time": 1685015100,
    "value": 3338.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1463,
    "Unnamed: 0": 1847,
    "time": 1685015400,
    "value": 13343.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1464,
    "Unnamed: 0": 1848,
    "time": 1685015700,
    "value": 25860.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1465,
    "Unnamed: 0": 1849,
    "time": 1685016000,
    "value": 231796.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1466,
    "Unnamed: 0": 1850,
    "time": 1685016300,
    "value": 44648.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1467,
    "Unnamed: 0": 1851,
    "time": 1685016600,
    "value": 45578.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1468,
    "Unnamed: 0": 1852,
    "time": 1685016900,
    "value": 40000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1469,
    "Unnamed: 0": 1853,
    "time": 1685017200,
    "value": 34543.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1470,
    "Unnamed: 0": 1854,
    "time": 1685017500,
    "value": 30956.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1471,
    "Unnamed: 0": 1855,
    "time": 1685017800,
    "value": 60830.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1472,
    "Unnamed: 0": 1856,
    "time": 1685018100,
    "value": 35091.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1473,
    "Unnamed: 0": 1857,
    "time": 1685018400,
    "value": 76265.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1474,
    "Unnamed: 0": 1858,
    "time": 1685018700,
    "value": 74132.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1475,
    "Unnamed: 0": 1859,
    "time": 1685019000,
    "value": 61890.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1476,
    "Unnamed: 0": 1860,
    "time": 1685019300,
    "value": 32758.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1477,
    "Unnamed: 0": 1861,
    "time": 1685019600,
    "value": 62351.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1478,
    "Unnamed: 0": 1862,
    "time": 1685019900,
    "value": 40454.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1479,
    "Unnamed: 0": 1863,
    "time": 1685020200,
    "value": 26228.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1480,
    "Unnamed: 0": 1864,
    "time": 1685020500,
    "value": 33391.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1481,
    "Unnamed: 0": 1865,
    "time": 1685020800,
    "value": 33653.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1482,
    "Unnamed: 0": 1866,
    "time": 1685021100,
    "value": 35309.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1483,
    "Unnamed: 0": 1867,
    "time": 1685021400,
    "value": 2829571.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1484,
    "Unnamed: 0": 1868,
    "time": 1685021700,
    "value": 1852954.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1485,
    "Unnamed: 0": 1869,
    "time": 1685022000,
    "value": 2203840.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1486,
    "Unnamed: 0": 1870,
    "time": 1685022300,
    "value": 2282488.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1487,
    "Unnamed: 0": 1871,
    "time": 1685022600,
    "value": 2003000.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1488,
    "Unnamed: 0": 1872,
    "time": 1685022900,
    "value": 1315487.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1489,
    "Unnamed: 0": 1873,
    "time": 1685023200,
    "value": 1469194.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1490,
    "Unnamed: 0": 1874,
    "time": 1685023500,
    "value": 1698064.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1491,
    "Unnamed: 0": 1875,
    "time": 1685023800,
    "value": 1641962.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1492,
    "Unnamed: 0": 1876,
    "time": 1685024100,
    "value": 1490956.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1493,
    "Unnamed: 0": 1877,
    "time": 1685024400,
    "value": 1178941.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1494,
    "Unnamed: 0": 1878,
    "time": 1685024700,
    "value": 1488942.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1495,
    "Unnamed: 0": 1879,
    "time": 1685025000,
    "value": 1338863.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1496,
    "Unnamed: 0": 1880,
    "time": 1685025300,
    "value": 1511944.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1497,
    "Unnamed: 0": 1881,
    "time": 1685025600,
    "value": 1418518.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1498,
    "Unnamed: 0": 1882,
    "time": 1685025900,
    "value": 1739624.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1499,
    "Unnamed: 0": 1883,
    "time": 1685026200,
    "value": 1019396.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1500,
    "Unnamed: 0": 1884,
    "time": 1685026500,
    "value": 951349.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1501,
    "Unnamed: 0": 1885,
    "time": 1685026800,
    "value": 1123378.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1502,
    "Unnamed: 0": 1886,
    "time": 1685027100,
    "value": 1292167.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1503,
    "Unnamed: 0": 1887,
    "time": 1685027400,
    "value": 1229650.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1504,
    "Unnamed: 0": 1888,
    "time": 1685027700,
    "value": 1229222.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1505,
    "Unnamed: 0": 1889,
    "time": 1685028000,
    "value": 1137236.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1506,
    "Unnamed: 0": 1890,
    "time": 1685028300,
    "value": 984208.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1507,
    "Unnamed: 0": 1891,
    "time": 1685028600,
    "value": 1055219.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1508,
    "Unnamed: 0": 1892,
    "time": 1685028900,
    "value": 1111427.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1509,
    "Unnamed: 0": 1893,
    "time": 1685029200,
    "value": 714874.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1510,
    "Unnamed: 0": 1894,
    "time": 1685029500,
    "value": 768589.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1511,
    "Unnamed: 0": 1895,
    "time": 1685029800,
    "value": 881841.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1512,
    "Unnamed: 0": 1896,
    "time": 1685030100,
    "value": 801053.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1513,
    "Unnamed: 0": 1897,
    "time": 1685030400,
    "value": 794304.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1514,
    "Unnamed: 0": 1898,
    "time": 1685030700,
    "value": 665435.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1515,
    "Unnamed: 0": 1899,
    "time": 1685031000,
    "value": 597881.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1516,
    "Unnamed: 0": 1900,
    "time": 1685031300,
    "value": 649929.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1517,
    "Unnamed: 0": 1901,
    "time": 1685031600,
    "value": 1107287.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1518,
    "Unnamed: 0": 1902,
    "time": 1685031900,
    "value": 1003887.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1519,
    "Unnamed: 0": 1903,
    "time": 1685032200,
    "value": 864849.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1520,
    "Unnamed: 0": 1904,
    "time": 1685032500,
    "value": 568670.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1521,
    "Unnamed: 0": 1905,
    "time": 1685032800,
    "value": 741136.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1522,
    "Unnamed: 0": 1906,
    "time": 1685033100,
    "value": 619779.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1523,
    "Unnamed: 0": 1907,
    "time": 1685033400,
    "value": 563197.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1524,
    "Unnamed: 0": 1908,
    "time": 1685033700,
    "value": 850767.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1525,
    "Unnamed: 0": 1909,
    "time": 1685034000,
    "value": 724485.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1526,
    "Unnamed: 0": 1910,
    "time": 1685034300,
    "value": 577698.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1527,
    "Unnamed: 0": 1911,
    "time": 1685034600,
    "value": 694323.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1528,
    "Unnamed: 0": 1912,
    "time": 1685034900,
    "value": 584609.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1529,
    "Unnamed: 0": 1913,
    "time": 1685035200,
    "value": 526218.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1530,
    "Unnamed: 0": 1914,
    "time": 1685035500,
    "value": 596305.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1531,
    "Unnamed: 0": 1915,
    "time": 1685035800,
    "value": 603923.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1532,
    "Unnamed: 0": 1916,
    "time": 1685036100,
    "value": 575720.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1533,
    "Unnamed: 0": 1917,
    "time": 1685036400,
    "value": 524317.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1534,
    "Unnamed: 0": 1918,
    "time": 1685036700,
    "value": 576451.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1535,
    "Unnamed: 0": 1919,
    "time": 1685037000,
    "value": 458732.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1536,
    "Unnamed: 0": 1920,
    "time": 1685037300,
    "value": 586909.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1537,
    "Unnamed: 0": 1921,
    "time": 1685037600,
    "value": 1063038.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1538,
    "Unnamed: 0": 1922,
    "time": 1685037900,
    "value": 932519.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1539,
    "Unnamed: 0": 1923,
    "time": 1685038200,
    "value": 532351.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1540,
    "Unnamed: 0": 1924,
    "time": 1685038500,
    "value": 781586.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1541,
    "Unnamed: 0": 1925,
    "time": 1685038800,
    "value": 868407.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1542,
    "Unnamed: 0": 1926,
    "time": 1685039100,
    "value": 704298.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1543,
    "Unnamed: 0": 1927,
    "time": 1685039400,
    "value": 900506.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1544,
    "Unnamed: 0": 1928,
    "time": 1685039700,
    "value": 549467.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1545,
    "Unnamed: 0": 1929,
    "time": 1685040000,
    "value": 714203.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1546,
    "Unnamed: 0": 1930,
    "time": 1685040300,
    "value": 770287.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1547,
    "Unnamed: 0": 1931,
    "time": 1685040600,
    "value": 517086.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1548,
    "Unnamed: 0": 1932,
    "time": 1685040900,
    "value": 1260390.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1549,
    "Unnamed: 0": 1933,
    "time": 1685041200,
    "value": 968338.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1550,
    "Unnamed: 0": 1934,
    "time": 1685041500,
    "value": 984833.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1551,
    "Unnamed: 0": 1935,
    "time": 1685041800,
    "value": 847092.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1552,
    "Unnamed: 0": 1936,
    "time": 1685042100,
    "value": 601777.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1553,
    "Unnamed: 0": 1937,
    "time": 1685042400,
    "value": 785687.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1554,
    "Unnamed: 0": 1938,
    "time": 1685042700,
    "value": 861470.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1555,
    "Unnamed: 0": 1939,
    "time": 1685043000,
    "value": 724312.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1556,
    "Unnamed: 0": 1940,
    "time": 1685043300,
    "value": 714282.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1557,
    "Unnamed: 0": 1941,
    "time": 1685043600,
    "value": 754149.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1558,
    "Unnamed: 0": 1942,
    "time": 1685043900,
    "value": 780752.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1559,
    "Unnamed: 0": 1943,
    "time": 1685044200,
    "value": 714461.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1560,
    "Unnamed: 0": 1944,
    "time": 1685044500,
    "value": 1281784.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1561,
    "Unnamed: 0": 1945,
    "time": 1685044800,
    "value": 2252427.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1562,
    "Unnamed: 0": 1946,
    "time": 1685045100,
    "value": 17136.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1563,
    "Unnamed: 0": 1947,
    "time": 1685045400,
    "value": 26795.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1564,
    "Unnamed: 0": 1948,
    "time": 1685045700,
    "value": 23072.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1565,
    "Unnamed: 0": 1949,
    "time": 1685046000,
    "value": 26375.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1566,
    "Unnamed: 0": 1950,
    "time": 1685046300,
    "value": 31547.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1567,
    "Unnamed: 0": 1951,
    "time": 1685046600,
    "value": 670082.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1568,
    "Unnamed: 0": 1952,
    "time": 1685046900,
    "value": 15575.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1569,
    "Unnamed: 0": 1953,
    "time": 1685047200,
    "value": 17145.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1570,
    "Unnamed: 0": 1954,
    "time": 1685047500,
    "value": 5888.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1571,
    "Unnamed: 0": 1955,
    "time": 1685047800,
    "value": 4515.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1572,
    "Unnamed: 0": 1956,
    "time": 1685048100,
    "value": 11790.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1573,
    "Unnamed: 0": 1957,
    "time": 1685048400,
    "value": 5387.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1574,
    "Unnamed: 0": 1958,
    "time": 1685048700,
    "value": 1431.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1575,
    "Unnamed: 0": 1959,
    "time": 1685049000,
    "value": 4687.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1576,
    "Unnamed: 0": 1960,
    "time": 1685049300,
    "value": 4579.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1577,
    "Unnamed: 0": 1961,
    "time": 1685049600,
    "value": 4763.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1578,
    "Unnamed: 0": 1962,
    "time": 1685049900,
    "value": 24759.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1579,
    "Unnamed: 0": 1963,
    "time": 1685050200,
    "value": 6600.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1580,
    "Unnamed: 0": 1964,
    "time": 1685050500,
    "value": 11233.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1581,
    "Unnamed: 0": 1965,
    "time": 1685050800,
    "value": 23926.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1582,
    "Unnamed: 0": 1966,
    "time": 1685051100,
    "value": 64326.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1583,
    "Unnamed: 0": 1967,
    "time": 1685051400,
    "value": 23727.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1584,
    "Unnamed: 0": 1968,
    "time": 1685051700,
    "value": 11357.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1585,
    "Unnamed: 0": 1969,
    "time": 1685052000,
    "value": 13141.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1586,
    "Unnamed: 0": 1970,
    "time": 1685052300,
    "value": 6682.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1587,
    "Unnamed: 0": 1971,
    "time": 1685052600,
    "value": 6543.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1588,
    "Unnamed: 0": 1972,
    "time": 1685052900,
    "value": 8928.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1589,
    "Unnamed: 0": 1973,
    "time": 1685053200,
    "value": 3581.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1590,
    "Unnamed: 0": 1974,
    "time": 1685053500,
    "value": 2015.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1591,
    "Unnamed: 0": 1975,
    "time": 1685053800,
    "value": 12217.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1592,
    "Unnamed: 0": 1976,
    "time": 1685054100,
    "value": 6681.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1593,
    "Unnamed: 0": 1977,
    "time": 1685054400,
    "value": 5946.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1594,
    "Unnamed: 0": 1978,
    "time": 1685054700,
    "value": 4878.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1595,
    "Unnamed: 0": 1979,
    "time": 1685055000,
    "value": 2234.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1596,
    "Unnamed: 0": 1980,
    "time": 1685055300,
    "value": 3454.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1597,
    "Unnamed: 0": 1981,
    "time": 1685055600,
    "value": 12573.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1598,
    "Unnamed: 0": 1982,
    "time": 1685055900,
    "value": 12845.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1599,
    "Unnamed: 0": 1983,
    "time": 1685056200,
    "value": 21997.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1600,
    "Unnamed: 0": 1984,
    "time": 1685056500,
    "value": 18027.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1601,
    "Unnamed: 0": 1985,
    "time": 1685056800,
    "value": 11378.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1602,
    "Unnamed: 0": 1986,
    "time": 1685057100,
    "value": 22882.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1603,
    "Unnamed: 0": 1987,
    "time": 1685057400,
    "value": 2494.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1604,
    "Unnamed: 0": 1988,
    "time": 1685057700,
    "value": 7065.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1605,
    "Unnamed: 0": 1989,
    "time": 1685058000,
    "value": 22634.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1606,
    "Unnamed: 0": 1990,
    "time": 1685058300,
    "value": 7242.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1607,
    "Unnamed: 0": 1991,
    "time": 1685058600,
    "value": 7078.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1608,
    "Unnamed: 0": 1992,
    "time": 1685058900,
    "value": 16478.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1609,
    "Unnamed: 0": 1993,
    "time": 1685088000,
    "value": 5191.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1610,
    "Unnamed: 0": 1994,
    "time": 1685088300,
    "value": 879.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1611,
    "Unnamed: 0": 1995,
    "time": 1685088600,
    "value": 1157.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1612,
    "Unnamed: 0": 1996,
    "time": 1685088900,
    "value": 1252.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1613,
    "Unnamed: 0": 1997,
    "time": 1685089200,
    "value": 2660.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1614,
    "Unnamed: 0": 1998,
    "time": 1685089500,
    "value": 1523.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1615,
    "Unnamed: 0": 1999,
    "time": 1685089800,
    "value": 6223.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1616,
    "Unnamed: 0": 2000,
    "time": 1685090100,
    "value": 2592.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1617,
    "Unnamed: 0": 2001,
    "time": 1685090400,
    "value": 1841.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1618,
    "Unnamed: 0": 2002,
    "time": 1685090700,
    "value": 3654.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1619,
    "Unnamed: 0": 2003,
    "time": 1685091000,
    "value": 1897.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1620,
    "Unnamed: 0": 2004,
    "time": 1685091300,
    "value": 2082.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1621,
    "Unnamed: 0": 2005,
    "time": 1685091600,
    "value": 200.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1622,
    "Unnamed: 0": 2006,
    "time": 1685091900,
    "value": 2896.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1623,
    "Unnamed: 0": 2007,
    "time": 1685092200,
    "value": 638.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1624,
    "Unnamed: 0": 2008,
    "time": 1685092500,
    "value": 780.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1625,
    "Unnamed: 0": 2009,
    "time": 1685092800,
    "value": 546.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1626,
    "Unnamed: 0": 2010,
    "time": 1685093100,
    "value": 1038.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1627,
    "Unnamed: 0": 2011,
    "time": 1685093400,
    "value": 862.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1628,
    "Unnamed: 0": 2012,
    "time": 1685093700,
    "value": 2416.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1629,
    "Unnamed: 0": 2013,
    "time": 1685094000,
    "value": 380.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1630,
    "Unnamed: 0": 2014,
    "time": 1685094300,
    "value": 1271.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1631,
    "Unnamed: 0": 2015,
    "time": 1685094600,
    "value": 1447.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1632,
    "Unnamed: 0": 2016,
    "time": 1685094900,
    "value": 1050.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1633,
    "Unnamed: 0": 2017,
    "time": 1685095200,
    "value": 648.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1634,
    "Unnamed: 0": 2018,
    "time": 1685095500,
    "value": 641.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1635,
    "Unnamed: 0": 2019,
    "time": 1685095800,
    "value": 1215.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1636,
    "Unnamed: 0": 2020,
    "time": 1685096100,
    "value": 3147.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1637,
    "Unnamed: 0": 2021,
    "time": 1685096400,
    "value": 1849.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1638,
    "Unnamed: 0": 2022,
    "time": 1685096700,
    "value": 1783.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1639,
    "Unnamed: 0": 2023,
    "time": 1685097000,
    "value": 2895.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1640,
    "Unnamed: 0": 2024,
    "time": 1685097300,
    "value": 6270.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1641,
    "Unnamed: 0": 2025,
    "time": 1685097600,
    "value": 7887.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1642,
    "Unnamed: 0": 2026,
    "time": 1685097900,
    "value": 5225.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1643,
    "Unnamed: 0": 2027,
    "time": 1685098200,
    "value": 687.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1644,
    "Unnamed: 0": 2028,
    "time": 1685098500,
    "value": 1369.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1645,
    "Unnamed: 0": 2029,
    "time": 1685098800,
    "value": 35992.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1646,
    "Unnamed: 0": 2030,
    "time": 1685099100,
    "value": 12554.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1647,
    "Unnamed: 0": 2031,
    "time": 1685099400,
    "value": 12412.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1648,
    "Unnamed: 0": 2032,
    "time": 1685099700,
    "value": 3733.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1649,
    "Unnamed: 0": 2033,
    "time": 1685100000,
    "value": 9264.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1650,
    "Unnamed: 0": 2034,
    "time": 1685100300,
    "value": 14494.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1651,
    "Unnamed: 0": 2035,
    "time": 1685100600,
    "value": 5696.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1652,
    "Unnamed: 0": 2036,
    "time": 1685100900,
    "value": 4434.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1653,
    "Unnamed: 0": 2037,
    "time": 1685101200,
    "value": 3790.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1654,
    "Unnamed: 0": 2038,
    "time": 1685101500,
    "value": 5005.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1655,
    "Unnamed: 0": 2039,
    "time": 1685101800,
    "value": 14560.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1656,
    "Unnamed: 0": 2040,
    "time": 1685102100,
    "value": 6114.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1657,
    "Unnamed: 0": 2041,
    "time": 1685102400,
    "value": 132802.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1658,
    "Unnamed: 0": 2042,
    "time": 1685102700,
    "value": 34459.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1659,
    "Unnamed: 0": 2043,
    "time": 1685103000,
    "value": 22021.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1660,
    "Unnamed: 0": 2044,
    "time": 1685103300,
    "value": 7083.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1661,
    "Unnamed: 0": 2045,
    "time": 1685103600,
    "value": 24179.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1662,
    "Unnamed: 0": 2046,
    "time": 1685103900,
    "value": 13408.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1663,
    "Unnamed: 0": 2047,
    "time": 1685104200,
    "value": 80732.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1664,
    "Unnamed: 0": 2048,
    "time": 1685104500,
    "value": 61961.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1665,
    "Unnamed: 0": 2049,
    "time": 1685104800,
    "value": 49778.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1666,
    "Unnamed: 0": 2050,
    "time": 1685105100,
    "value": 42555.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1667,
    "Unnamed: 0": 2051,
    "time": 1685105400,
    "value": 24877.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1668,
    "Unnamed: 0": 2052,
    "time": 1685105700,
    "value": 15189.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1669,
    "Unnamed: 0": 2053,
    "time": 1685106000,
    "value": 43348.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1670,
    "Unnamed: 0": 2054,
    "time": 1685106300,
    "value": 15621.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1671,
    "Unnamed: 0": 2055,
    "time": 1685106600,
    "value": 43769.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1672,
    "Unnamed: 0": 2056,
    "time": 1685106900,
    "value": 18150.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1673,
    "Unnamed: 0": 2057,
    "time": 1685107200,
    "value": 22540.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1674,
    "Unnamed: 0": 2058,
    "time": 1685107500,
    "value": 53562.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1675,
    "Unnamed: 0": 2059,
    "time": 1685107800,
    "value": 3062929.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1676,
    "Unnamed: 0": 2060,
    "time": 1685108100,
    "value": 3672718.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1677,
    "Unnamed: 0": 2061,
    "time": 1685108400,
    "value": 2497943.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1678,
    "Unnamed: 0": 2062,
    "time": 1685108700,
    "value": 2514770.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1679,
    "Unnamed: 0": 2063,
    "time": 1685109000,
    "value": 2286367.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1680,
    "Unnamed: 0": 2064,
    "time": 1685109300,
    "value": 2527779.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1681,
    "Unnamed: 0": 2065,
    "time": 1685109600,
    "value": 2665416.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1682,
    "Unnamed: 0": 2066,
    "time": 1685109900,
    "value": 2386135.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1683,
    "Unnamed: 0": 2067,
    "time": 1685110200,
    "value": 2685790.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1684,
    "Unnamed: 0": 2068,
    "time": 1685110500,
    "value": 2092301.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1685,
    "Unnamed: 0": 2069,
    "time": 1685110800,
    "value": 2048051.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1686,
    "Unnamed: 0": 2070,
    "time": 1685111100,
    "value": 1356941.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1687,
    "Unnamed: 0": 2071,
    "time": 1685111400,
    "value": 1510664.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1688,
    "Unnamed: 0": 2072,
    "time": 1685111700,
    "value": 2401568.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1689,
    "Unnamed: 0": 2073,
    "time": 1685112000,
    "value": 1908080.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1690,
    "Unnamed: 0": 2074,
    "time": 1685112300,
    "value": 1212999.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1691,
    "Unnamed: 0": 2075,
    "time": 1685112600,
    "value": 1375814.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1692,
    "Unnamed: 0": 2076,
    "time": 1685112900,
    "value": 1636935.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1693,
    "Unnamed: 0": 2077,
    "time": 1685113200,
    "value": 1359457.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1694,
    "Unnamed: 0": 2078,
    "time": 1685113500,
    "value": 1244548.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1695,
    "Unnamed: 0": 2079,
    "time": 1685113800,
    "value": 1301854.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1696,
    "Unnamed: 0": 2080,
    "time": 1685114100,
    "value": 1151250.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1697,
    "Unnamed: 0": 2081,
    "time": 1685114400,
    "value": 1240240.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1698,
    "Unnamed: 0": 2082,
    "time": 1685114700,
    "value": 1162304.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1699,
    "Unnamed: 0": 2083,
    "time": 1685115000,
    "value": 1718653.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1700,
    "Unnamed: 0": 2084,
    "time": 1685115300,
    "value": 1132471.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1701,
    "Unnamed: 0": 2085,
    "time": 1685115600,
    "value": 1628788.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1702,
    "Unnamed: 0": 2086,
    "time": 1685115900,
    "value": 2358442.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1703,
    "Unnamed: 0": 2087,
    "time": 1685116200,
    "value": 2804844.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1704,
    "Unnamed: 0": 2088,
    "time": 1685116500,
    "value": 1868434.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1705,
    "Unnamed: 0": 2089,
    "time": 1685116800,
    "value": 1571368.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1706,
    "Unnamed: 0": 2090,
    "time": 1685117100,
    "value": 1444228.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1707,
    "Unnamed: 0": 2091,
    "time": 1685117400,
    "value": 1283667.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1708,
    "Unnamed: 0": 2092,
    "time": 1685117700,
    "value": 1021951.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1709,
    "Unnamed: 0": 2093,
    "time": 1685118000,
    "value": 1317942.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1710,
    "Unnamed: 0": 2094,
    "time": 1685118300,
    "value": 897946.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1711,
    "Unnamed: 0": 2095,
    "time": 1685118600,
    "value": 1785279.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1712,
    "Unnamed: 0": 2096,
    "time": 1685118900,
    "value": 1187912.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1713,
    "Unnamed: 0": 2097,
    "time": 1685119200,
    "value": 1101734.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1714,
    "Unnamed: 0": 2098,
    "time": 1685119500,
    "value": 1431107.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1715,
    "Unnamed: 0": 2099,
    "time": 1685119800,
    "value": 1518276.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1716,
    "Unnamed: 0": 2100,
    "time": 1685120100,
    "value": 2525074.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1717,
    "Unnamed: 0": 2101,
    "time": 1685120400,
    "value": 2439860.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1718,
    "Unnamed: 0": 2102,
    "time": 1685120700,
    "value": 2443147.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1719,
    "Unnamed: 0": 2103,
    "time": 1685121000,
    "value": 1984224.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1720,
    "Unnamed: 0": 2104,
    "time": 1685121300,
    "value": 2604340.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1721,
    "Unnamed: 0": 2105,
    "time": 1685121600,
    "value": 1722430.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1722,
    "Unnamed: 0": 2106,
    "time": 1685121900,
    "value": 1716175.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1723,
    "Unnamed: 0": 2107,
    "time": 1685122200,
    "value": 1532340.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1724,
    "Unnamed: 0": 2108,
    "time": 1685122500,
    "value": 1171769.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1725,
    "Unnamed: 0": 2109,
    "time": 1685122800,
    "value": 1753245.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1726,
    "Unnamed: 0": 2110,
    "time": 1685123100,
    "value": 1742905.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1727,
    "Unnamed: 0": 2111,
    "time": 1685123400,
    "value": 1516725.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1728,
    "Unnamed: 0": 2112,
    "time": 1685123700,
    "value": 1273004.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1729,
    "Unnamed: 0": 2113,
    "time": 1685124000,
    "value": 1453291.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1730,
    "Unnamed: 0": 2114,
    "time": 1685124300,
    "value": 1241825.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1731,
    "Unnamed: 0": 2115,
    "time": 1685124600,
    "value": 1342020.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1732,
    "Unnamed: 0": 2116,
    "time": 1685124900,
    "value": 1276314.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1733,
    "Unnamed: 0": 2117,
    "time": 1685125200,
    "value": 1197003.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1734,
    "Unnamed: 0": 2118,
    "time": 1685125500,
    "value": 1173298.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1735,
    "Unnamed: 0": 2119,
    "time": 1685125800,
    "value": 1281664.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1736,
    "Unnamed: 0": 2120,
    "time": 1685126100,
    "value": 1157209.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1737,
    "Unnamed: 0": 2121,
    "time": 1685126400,
    "value": 1238728.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1738,
    "Unnamed: 0": 2122,
    "time": 1685126700,
    "value": 1481045.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1739,
    "Unnamed: 0": 2123,
    "time": 1685127000,
    "value": 728676.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1740,
    "Unnamed: 0": 2124,
    "time": 1685127300,
    "value": 1413645.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1741,
    "Unnamed: 0": 2125,
    "time": 1685127600,
    "value": 883915.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1742,
    "Unnamed: 0": 2126,
    "time": 1685127900,
    "value": 1123465.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1743,
    "Unnamed: 0": 2127,
    "time": 1685128200,
    "value": 1651612.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1744,
    "Unnamed: 0": 2128,
    "time": 1685128500,
    "value": 781915.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1745,
    "Unnamed: 0": 2129,
    "time": 1685128800,
    "value": 1220426.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1746,
    "Unnamed: 0": 2130,
    "time": 1685129100,
    "value": 1838513.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1747,
    "Unnamed: 0": 2131,
    "time": 1685129400,
    "value": 1681213.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1748,
    "Unnamed: 0": 2132,
    "time": 1685129700,
    "value": 2091226.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1749,
    "Unnamed: 0": 2133,
    "time": 1685130000,
    "value": 1635088.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1750,
    "Unnamed: 0": 2134,
    "time": 1685130300,
    "value": 2301804.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1751,
    "Unnamed: 0": 2135,
    "time": 1685130600,
    "value": 2354994.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1752,
    "Unnamed: 0": 2136,
    "time": 1685130900,
    "value": 2261910.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1753,
    "Unnamed: 0": 2137,
    "time": 1685131200,
    "value": 2580871.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1754,
    "Unnamed: 0": 2138,
    "time": 1685131500,
    "value": 104363.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1755,
    "Unnamed: 0": 2139,
    "time": 1685131800,
    "value": 44045.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1756,
    "Unnamed: 0": 2140,
    "time": 1685132100,
    "value": 19153.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1757,
    "Unnamed: 0": 2141,
    "time": 1685132400,
    "value": 24898.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1758,
    "Unnamed: 0": 2142,
    "time": 1685132700,
    "value": 19782.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1759,
    "Unnamed: 0": 2143,
    "time": 1685133000,
    "value": 27455.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1760,
    "Unnamed: 0": 2144,
    "time": 1685133300,
    "value": 43506.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1761,
    "Unnamed: 0": 2145,
    "time": 1685133600,
    "value": 25726.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1762,
    "Unnamed: 0": 2146,
    "time": 1685133900,
    "value": 14651.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1763,
    "Unnamed: 0": 2147,
    "time": 1685134200,
    "value": 16925.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1764,
    "Unnamed: 0": 2148,
    "time": 1685134500,
    "value": 37783.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1765,
    "Unnamed: 0": 2149,
    "time": 1685134800,
    "value": 47049.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1766,
    "Unnamed: 0": 2150,
    "time": 1685135100,
    "value": 59432.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1767,
    "Unnamed: 0": 2151,
    "time": 1685135400,
    "value": 19660.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1768,
    "Unnamed: 0": 2152,
    "time": 1685135700,
    "value": 26867.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1769,
    "Unnamed: 0": 2153,
    "time": 1685136000,
    "value": 10128.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1770,
    "Unnamed: 0": 2154,
    "time": 1685136300,
    "value": 16376.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1771,
    "Unnamed: 0": 2155,
    "time": 1685136600,
    "value": 14854.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1772,
    "Unnamed: 0": 2156,
    "time": 1685136900,
    "value": 15762.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1773,
    "Unnamed: 0": 2157,
    "time": 1685137200,
    "value": 30938.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1774,
    "Unnamed: 0": 2158,
    "time": 1685137500,
    "value": 21215.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1775,
    "Unnamed: 0": 2159,
    "time": 1685137800,
    "value": 13265.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1776,
    "Unnamed: 0": 2160,
    "time": 1685138100,
    "value": 9442.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1777,
    "Unnamed: 0": 2161,
    "time": 1685138400,
    "value": 12102.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1778,
    "Unnamed: 0": 2162,
    "time": 1685138700,
    "value": 12518.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1779,
    "Unnamed: 0": 2163,
    "time": 1685139000,
    "value": 21094.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1780,
    "Unnamed: 0": 2164,
    "time": 1685139300,
    "value": 10008.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1781,
    "Unnamed: 0": 2165,
    "time": 1685139600,
    "value": 7385.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1782,
    "Unnamed: 0": 2166,
    "time": 1685139900,
    "value": 7152.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1783,
    "Unnamed: 0": 2167,
    "time": 1685140200,
    "value": 7736.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1784,
    "Unnamed: 0": 2168,
    "time": 1685140500,
    "value": 13150.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1785,
    "Unnamed: 0": 2169,
    "time": 1685140800,
    "value": 15393.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1786,
    "Unnamed: 0": 2170,
    "time": 1685141100,
    "value": 8134.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1787,
    "Unnamed: 0": 2171,
    "time": 1685141400,
    "value": 2680.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1788,
    "Unnamed: 0": 2172,
    "time": 1685141700,
    "value": 9564.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1789,
    "Unnamed: 0": 2173,
    "time": 1685142000,
    "value": 6062.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1790,
    "Unnamed: 0": 2174,
    "time": 1685142300,
    "value": 6838.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1791,
    "Unnamed: 0": 2175,
    "time": 1685142600,
    "value": 9828.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1792,
    "Unnamed: 0": 2176,
    "time": 1685142900,
    "value": 3388.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1793,
    "Unnamed: 0": 2177,
    "time": 1685143200,
    "value": 4008.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1794,
    "Unnamed: 0": 2178,
    "time": 1685143500,
    "value": 6933.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1795,
    "Unnamed: 0": 2179,
    "time": 1685143800,
    "value": 9716.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1796,
    "Unnamed: 0": 2180,
    "time": 1685144100,
    "value": 10243.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1797,
    "Unnamed: 0": 2181,
    "time": 1685144400,
    "value": 15379.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1798,
    "Unnamed: 0": 2182,
    "time": 1685144700,
    "value": 10666.0,
    "color": "rgba(200,127,130,0.8)"
  },
  {
    "Unnamed: 0.1": 1799,
    "Unnamed: 0": 2183,
    "time": 1685145000,
    "value": 21861.0,
    "color": "rgba(83,141,131,0.8)"
  },
  {
    "Unnamed: 0.1": 1800,
    "Unnamed: 0": 2184,
    "time": 1685145300,
    "value": 37319.0,
    "color": "rgba(200,127,130,0.8)"
  }
])

            if (!window.ltoukohz.chart.priceScale("right").options.autoScale)
                window.ltoukohz.chart.priceScale("right").applyOptions({autoScale: true})
        
window.ltoukohz.toolBox?.clearDrawings()


        window.hkppmcvz = new Lib.HorizontalLine(
            {price: 200},
            {
                lineColor: 'rgb(122, 146, 202)',
                lineStyle: 0,
                width: 2,
                text: ``,
            },
            callbackName='window.hkppmcvz'
        )
        window.ltoukohz.series.attachPrimitive(window.hkppmcvz)
        
window.ltoukohz.toolBox?.addNewDrawing(window.hkppmcvz)
/*==========*/
window.pywebview._returnValues["callback"]["6410492283162021"] = {value: 'null'}