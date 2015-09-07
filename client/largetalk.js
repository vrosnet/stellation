(function() {
	"use strict";

	var MIMETYPE = "text/largetalk";
	var GRAMMAR_MIMETYPE = "text/largetalk-grammar";


	var grammar;

	var LT = {};
	window.LT = LT;

	/* =================================================================== */
	/*                             UTILITIES                               */
	/* =================================================================== */

	/* Converts an array-like into an array. */

	function arrayOf(o) {
		return Array.prototype.slice.call(o);
	}

	/* =================================================================== */
	/*                           STANDARD LIBRARY                          */
	/* =================================================================== */

	var serial_number = 0;

	var system_dictionary = {};
	LT.systemDictionary = system_dictionary;

	function make_raw_class(name, superklass) {
		return {
			_st_number: serial_number++,
			_st_vars: {},
			_st_super: superklass,
			_st_methods: superklass ? Object.create(superklass._st_methods) : {},
			_st_name: name,
			_st_ivars: {}
		};
	}

	function make_named_class(name, superklassname) {
		var superklass = superklassname ? system_dictionary["$" + superklassname] : null;
		var o = make_raw_class(name, superklass);
		system_dictionary["$" + name] = o;
		return o;
	}

	make_named_class("Object", null);
	make_named_class("Behavior", "Object");
	make_named_class("ClassDescription", "Behavior");
	make_named_class("Class", "ClassDescription");
	var _Metaklass = make_named_class("Metaclass", "ClassDescription");

	function makevars(o) {
		var c = o._st_class;
		while (c) {
			o._st_vars[c._st_number] = {};
			c = c._st_super;
		}
	}

	function assign_metaclass(name) {
		var object = system_dictionary["$" + name];
		var superklass = object._st_super;
		if (superklass)
			superklass = superklass._st_class;
		else
			superklass = _Metaklass;

		var metaklass = make_raw_class(name + " class", superklass);
		object._st_class = metaklass;
		makevars(object);

		metaklass._st_class = _Metaklass;
		makevars(metaklass);
	}

	assign_metaclass("Object");
	assign_metaclass("Behavior");
	assign_metaclass("ClassDescription");
	assign_metaclass("Class");
	assign_metaclass("Metaclass");

	LT.makeObject = function(superklass) {
		var o = {
			_st_number: serial_number++,
			_st_vars: {},
			_st_class: superklass
		};
		makevars(o);
		return o;
	};

	var primitive_table = {
		string: "String",
		number: "Number"
	};

	LT.findMethod = function(receiver, name) {
		var c = receiver._st_class;
		if (!c) {
			c = primitive_table[typeof(receiver)];
			if (!c)
				throw new Error("Can't call methods on " + typeof(receiver) +" yet");
			if (typeof(c) !== "object") {
				c = system_dictionary["$" + c];
				primitive_table[typeof(receiver)] = c;
			}
		}

		return c._st_methods[name];
	}

	LT.makeSubclass = function(superklass, name) {
		var klass = make_raw_class(name, superklass);
		system_dictionary["$" + name] = klass;

		var metaklass = make_raw_class(name + " class", superklass._st_class);
		klass._st_class = metaklass;
		metaklass._st_class = _Metaklass;

		makevars(klass);
		makevars(metaklass);
		return klass;
	}

	/* =================================================================== */
	/*                              COMPILER                               */
	/* =================================================================== */

	function compile_expr(context, node) {
		switch (node.type) {
			case "javascript":
				return node.body;

			case "identifier":
				return "$" + node.name;

			case "call":
			{
				var t = context.temporaries++;
				var f = [];
				f.push("(t");
				f.push(t);
				f.push(" = (");
				f.push(compile_expr(context, node.receiver));
				f.push("), LT.findMethod(t");
				f.push(t);
				f.push(",");
				f.push("'" + node.name + "'");
				f.push(")(t");
				f.push(t);
				for (var i=0; i<node.args.length; i++) {
					f.push(",");
					f.push(compile_expr(context, node.args[i]));
				}
				f.push("))");
				return f.join("");
			}

			case "string":
				return JSON.stringify(node.value);
				
			default:
				throw new Error("Unknown expression node " + node.type);
		}
	}

	function compile_block(node) {
		var f = [];
		var maxtemporaries = 0;
		var context = {
			temporaries: 0
		};

		for (var i=0; i<node.body.length; i++) {
			var n = node.body[i];
			switch (n.type) {
				case "variables":
					for (var j=0; j<n.identifiers.length; j++) {
						var id = n.identifiers[j];
						f.push("var $" + id.name + " = null;");
					}
					break;

				case "return":
					f.push("retval.value = " + compile_expr(context, n.expression) + ";");
					f.push("throw retval;");
					break;

				case "assign":
					f.push("$" + n.name.name + " = " + compile_expr(context, n.expression) + ";");
					break;

				case "expression":
					f.push(compile_expr(context, n.expression) + ";");
					break;

				default:
					throw new Error("Unknown method body node " + n.type);
			}

			maxtemporaries = Math.max(context.temporaries);
			context.temporaries = 0;
		}

		if (maxtemporaries > 0) {
			for (var i=0; i<maxtemporaries; i++)
				f.unshift("var t" + i + ";");
		}

		return f;
	}

	function compile_method(klass, node) {
		var vars = node.pattern.vars.map(
			function (v) { return "$" + v.name; }
		);
		vars.unshift("self");

		var f = [];
		f.push("with (LT.systemDictionary) {");
		f.push("return (function(" + vars.join(",") + ") {");
		f.push("var retval = {value: self};");
		f.push("try {");

		f.push("var vars = self._st_vars;");
		f.push("with (vars ? vars[" + klass._st_number + "] : {}) {");
		f = f.concat(compile_block(node));
		f.push("}");

		f.push("} catch (e) {");
		f.push("if (e !== retval) throw e;");
		f.push("}");
		f.push("return retval.value;");
		f.push("});");
		f.push("}");

		var cf = new Function(f.join("\n"));
		var ccf = cf();

		return {
			name: node.pattern.name,
			callable: ccf
		};
	}

	function compile_jmethod(klass, node) {
		var vars = node.pattern.vars.map(
			function (v) { return "$" + v.name; }
		);
		vars.unshift("self");

		var f = [];
		f.push("return (function(" + vars.join(",") + ") {");
		f.push(node.body.body);
		f.push("});");

		var cf = new Function(f.join("\n"));
		var ccf = cf();

		return {
			name: node.pattern.name,
			callable: ccf
		};
	}

	function compile_class_body(klass, nodes) {
		for (var i=0; i<nodes.length; i++) {
			var node = nodes[i];

			switch (node.type) {
				case "method":
					var m = compile_method(klass, node);
					klass._st_methods[m.name] = m.callable;
					break;

				case "jmethod":
					var m = compile_jmethod(klass, node);
					klass._st_methods[m.name] = m.callable;
					break;

				case "variables":
					for (var j=0; j<node.identifiers.length; j++)
						klass._st_ivars["$" + node.identifiers[j].name] = true;
					break;

				default:
					throw new Error("Unsupported class body node " + node.type);
			}
		}
	}

	var toplevel_nodes = {
		block:
			function(node) {
				var f = [];
				f.push("with (LT.systemDictionary) {");
				f.push("var retval = null;");
				f = f.concat(compile_block(node));
				f.push("}");

				var cf = new Function(f.join("\n"));
				cf.call(null);
			},

		extend:
			function(node) {
				var klass = system_dictionary["$" + node.class.name];
				if (!klass)
					throw new Error("Undefined LT class '" + node.class.name + "'");

				compile_class_body(klass, node.body);
			},

		subclass:
			function(node) {
				var klass = system_dictionary["$" + node.class.name];
				if (!klass)
					throw new Error("Undefined LT class '" + node.class.name + "'");

				var subklass = LT.findMethod(klass, "subclass:")(klass, node.name.name);
				compile_class_body(subklass, node.body);
			}
	};

	function compile_toplevel(node) {
		var cb = toplevel_nodes[node.type];
		if (!cb)
			throw new Error("Unsupported toplevel node " + node.type);

		return cb(node);
	}

	function compile(source) {
		var ast;
		try {
			ast = grammar.parse(source);
		} catch (e) {
			if (e.name == "SyntaxError") {
				e.message = e.location.start.line + "." +
					e.location.start.column + ":" +
					e.message;
			}
			throw e;
		}

		for (var i=0; i<ast.length; i++)
			compile_toplevel(ast[i]);
	}

	/* =================================================================== */
	/*                              STARTUP                                */
	/* =================================================================== */

	/* Construct the list of candidate elements. */

	var largetalk_elements = [];
	var grammar_element;

	function start_loading_script(element) {
		if (element._st_req) return;

		var req = element._st_req = new XMLHttpRequest();
		req.open("GET", element.getAttribute("src"));
		req.onload = function(e) {
			element._st_src = req.responseText;
			done_loading_scripts();
		};
		req.send();
	}

	function done_loading_scripts() {
		/* Don't do ANYTHING until the grammar has loaded. */

		if (!grammar_element) return;
		if (!grammar_element._st_src != "") return;
		if (!grammar) {
			grammar = PEG.buildParser(grammar_element._st_src, {
			});
		}

		/* Consume any scripts that have finished loading (being careful to
		 * maintain the right order!) */

		for (;;) {
			var element = largetalk_elements[0];
			if (!element) break;
			if (!element._st_src) break;

			console.log("Compiling " + element.src);
			compile(element._st_src);

			largetalk_elements.shift();
		}
	}

	/* Ensure that any new script elements are found and handled. */

	var observer = new MutationObserver(function(mutations) {
		mutations.forEach(function(mutation) {
			arrayOf(mutation.addedNodes).forEach(
				function(element) {
					if (element.nodeName != "SCRIPT") return;

					switch (element.getAttribute("type")) {
						case MIMETYPE:
							largetalk_elements.push(element);
							start_loading_script(element);
							break;

						case GRAMMAR_MIMETYPE:
							grammar_element = element;
							start_loading_script(element);
							break;
					}
				}
			)
		});
	});

	observer.observe(document, {
		childList: true,
		subtree: true
	});
})();

