(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var MongoInternals = Package.mongo.MongoInternals;
var Mongo = Package.mongo.Mongo;
var LocalCollection = Package.minimongo.LocalCollection;
var Minimongo = Package.minimongo.Minimongo;
var EventEmitter = Package['raix:eventemitter'].EventEmitter;
var ECMAScript = Package.ecmascript.ECMAScript;
var meteorInstall = Package.modules.meteorInstall;
var meteorBabelHelpers = Package['babel-runtime'].meteorBabelHelpers;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var Collection2;

var require = meteorInstall({"node_modules":{"meteor":{"aldeed:collection2":{"collection2.js":function(require,exports,module){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// packages/aldeed_collection2/collection2.js                                                                        //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
var _interopRequireDefault = require("@babel/runtime/helpers/builtin/interopRequireDefault");

var _objectSpread2 = _interopRequireDefault(require("@babel/runtime/helpers/builtin/objectSpread"));

let EventEmitter;
module.watch(require("meteor/raix:eventemitter"), {
  EventEmitter(v) {
    EventEmitter = v;
  }

}, 0);
let Meteor;
module.watch(require("meteor/meteor"), {
  Meteor(v) {
    Meteor = v;
  }

}, 1);
let Mongo;
module.watch(require("meteor/mongo"), {
  Mongo(v) {
    Mongo = v;
  }

}, 2);
let checkNpmVersions;
module.watch(require("meteor/tmeasday:check-npm-versions"), {
  checkNpmVersions(v) {
    checkNpmVersions = v;
  }

}, 3);
let clone;
module.watch(require("clone"), {
  default(v) {
    clone = v;
  }

}, 4);
let EJSON;
module.watch(require("ejson"), {
  default(v) {
    EJSON = v;
  }

}, 5);
let isEmpty;
module.watch(require("lodash.isempty"), {
  default(v) {
    isEmpty = v;
  }

}, 6);
let isEqual;
module.watch(require("lodash.isequal"), {
  default(v) {
    isEqual = v;
  }

}, 7);
let isObject;
module.watch(require("lodash.isobject"), {
  default(v) {
    isObject = v;
  }

}, 8);
checkNpmVersions({
  'simpl-schema': '>=0.0.0'
}, 'aldeed:collection2');

const SimpleSchema = require('simpl-schema').default; // Exported only for listening to events


const Collection2 = new EventEmitter();
const defaultCleanOptions = {
  filter: true,
  autoConvert: true,
  removeEmptyStrings: true,
  trimStrings: true,
  removeNullsFromArrays: false
};
/**
 * Mongo.Collection.prototype.attachSchema
 * @param {SimpleSchema|Object} ss - SimpleSchema instance or a schema definition object
 *    from which to create a new SimpleSchema instance
 * @param {Object} [options]
 * @param {Boolean} [options.transform=false] Set to `true` if your document must be passed
 *    through the collection's transform to properly validate.
 * @param {Boolean} [options.replace=false] Set to `true` to replace any existing schema instead of combining
 * @return {undefined}
 *
 * Use this method to attach a schema to a collection created by another package,
 * such as Meteor.users. It is most likely unsafe to call this method more than
 * once for a single collection, or to call this for a collection that had a
 * schema object passed to its constructor.
 */

Mongo.Collection.prototype.attachSchema = function c2AttachSchema(ss, options) {
  options = options || {}; // Allow passing just the schema object

  if (!(ss instanceof SimpleSchema)) {
    ss = new SimpleSchema(ss);
  }

  this._c2 = this._c2 || {}; // If we've already attached one schema, we combine both into a new schema unless options.replace is `true`

  if (this._c2._simpleSchema && options.replace !== true) {
    if (ss.version >= 2) {
      var newSS = new SimpleSchema(this._c2._simpleSchema);
      newSS.extend(ss);
      ss = newSS;
    } else {
      ss = new SimpleSchema([this._c2._simpleSchema, ss]);
    }
  }

  var selector = options.selector;

  function attachTo(obj) {
    if (typeof selector === "object") {
      // Index of existing schema with identical selector
      var schemaIndex = -1; // we need an array to hold multiple schemas

      obj._c2._simpleSchemas = obj._c2._simpleSchemas || []; // Loop through existing schemas with selectors

      obj._c2._simpleSchemas.forEach((schema, index) => {
        // if we find a schema with an identical selector, save it's index
        if (isEqual(schema.selector, selector)) {
          schemaIndex = index;
        }
      });

      if (schemaIndex === -1) {
        // We didn't find the schema in our array - push it into the array
        obj._c2._simpleSchemas.push({
          schema: new SimpleSchema(ss),
          selector: selector
        });
      } else {
        // We found a schema with an identical selector in our array,
        if (options.replace !== true) {
          // Merge with existing schema unless options.replace is `true`
          if (obj._c2._simpleSchemas[schemaIndex].schema.version >= 2) {
            obj._c2._simpleSchemas[schemaIndex].schema.extend(ss);
          } else {
            obj._c2._simpleSchemas[schemaIndex].schema = new SimpleSchema([obj._c2._simpleSchemas[schemaIndex].schema, ss]);
          }
        } else {
          // If options.repalce is `true` replace existing schema with new schema
          obj._c2._simpleSchemas[schemaIndex].schema = ss;
        }
      } // Remove existing schemas without selector


      delete obj._c2._simpleSchema;
    } else {
      // Track the schema in the collection
      obj._c2._simpleSchema = ss; // Remove existing schemas with selector

      delete obj._c2._simpleSchemas;
    }
  }

  attachTo(this); // Attach the schema to the underlying LocalCollection, too

  if (this._collection instanceof LocalCollection) {
    this._collection._c2 = this._collection._c2 || {};
    attachTo(this._collection);
  }

  defineDeny(this, options);
  keepInsecure(this);
  Collection2.emit('schema.attached', this, ss, options);
};

[Mongo.Collection, LocalCollection].forEach(obj => {
  /**
   * simpleSchema
   * @description function detect the correct schema by given params. If it
   * detect multi-schema presence in the collection, then it made an attempt to find a
   * `selector` in args
   * @param {Object} doc - It could be <update> on update/upsert or document
   * itself on insert/remove
   * @param {Object} [options] - It could be <update> on update/upsert etc
   * @param {Object} [query] - it could be <query> on update/upsert
   * @return {Object} Schema
   */
  obj.prototype.simpleSchema = function (doc, options, query) {
    if (!this._c2) return null;
    if (this._c2._simpleSchema) return this._c2._simpleSchema;
    var schemas = this._c2._simpleSchemas;

    if (schemas && schemas.length > 0) {
      if (!doc) throw new Error('collection.simpleSchema() requires doc argument when there are multiple schemas');
      var schema, selector, target;

      for (var i = 0; i < schemas.length; i++) {
        schema = schemas[i];
        selector = Object.keys(schema.selector)[0]; // We will set this to undefined because in theory you might want to select
        // on a null value.

        target = undefined; // here we are looking for selector in different places
        // $set should have more priority here

        if (doc.$set && typeof doc.$set[selector] !== 'undefined') {
          target = doc.$set[selector];
        } else if (typeof doc[selector] !== 'undefined') {
          target = doc[selector];
        } else if (options && options.selector) {
          target = options.selector[selector];
        } else if (query && query[selector]) {
          // on upsert/update operations
          target = query[selector];
        } // we need to compare given selector with doc property or option to
        // find right schema


        if (target !== undefined && target === schema.selector[selector]) {
          return schema.schema;
        }
      }
    }

    return null;
  };
}); // Wrap DB write operation methods

['insert', 'update'].forEach(methodName => {
  const _super = Mongo.Collection.prototype[methodName];

  Mongo.Collection.prototype[methodName] = function (...args) {
    let options = methodName === "insert" ? args[1] : args[2]; // Support missing options arg

    if (!options || typeof options === "function") {
      options = {};
    }

    if (this._c2 && options.bypassCollection2 !== true) {
      var userId = null;

      try {
        // https://github.com/aldeed/meteor-collection2/issues/175
        userId = Meteor.userId();
      } catch (err) {}

      args = doValidate(this, methodName, args, Meteor.isServer || this._connection === null, // getAutoValues
      userId, Meteor.isServer // isFromTrustedCode
      );

      if (!args) {
        // doValidate already called the callback or threw the error so we're done.
        // But insert should always return an ID to match core behavior.
        return methodName === "insert" ? this._makeNewID() : undefined;
      }
    } else {
      // We still need to adjust args because insert does not take options
      if (methodName === "insert" && typeof args[1] !== 'function') args.splice(1, 1);
    }

    return _super.apply(this, args);
  };
});
/*
 * Private
 */

function doValidate(collection, type, args, getAutoValues, userId, isFromTrustedCode) {
  var doc, callback, error, options, isUpsert, selector, last, hasCallback;

  if (!args.length) {
    throw new Error(type + " requires an argument");
  } // Gather arguments and cache the selector


  if (type === "insert") {
    doc = args[0];
    options = args[1];
    callback = args[2]; // The real insert doesn't take options

    if (typeof options === "function") {
      args = [doc, options];
    } else if (typeof callback === "function") {
      args = [doc, callback];
    } else {
      args = [doc];
    }
  } else if (type === "update") {
    selector = args[0];
    doc = args[1];
    options = args[2];
    callback = args[3];
  } else {
    throw new Error("invalid type argument");
  }

  var validatedObjectWasInitiallyEmpty = isEmpty(doc); // Support missing options arg

  if (!callback && typeof options === "function") {
    callback = options;
    options = {};
  }

  options = options || {};
  last = args.length - 1;
  hasCallback = typeof args[last] === 'function'; // If update was called with upsert:true, flag as an upsert

  isUpsert = type === "update" && options.upsert === true; // we need to pass `doc` and `options` to `simpleSchema` method, that's why
  // schema declaration moved here

  var schema = collection.simpleSchema(doc, options, selector);
  var isLocalCollection = collection._connection === null; // On the server and for local collections, we allow passing `getAutoValues: false` to disable autoValue functions

  if ((Meteor.isServer || isLocalCollection) && options.getAutoValues === false) {
    getAutoValues = false;
  } // Determine validation context


  var validationContext = options.validationContext;

  if (validationContext) {
    if (typeof validationContext === 'string') {
      validationContext = schema.namedContext(validationContext);
    }
  } else {
    validationContext = schema.namedContext();
  } // Add a default callback function if we're on the client and no callback was given


  if (Meteor.isClient && !callback) {
    // Client can't block, so it can't report errors by exception,
    // only by callback. If they forget the callback, give them a
    // default one that logs the error, so they aren't totally
    // baffled if their writes don't work because their database is
    // down.
    callback = function (err) {
      if (err) {
        Meteor._debug(type + " failed: " + (err.reason || err.stack));
      }
    };
  } // If client validation is fine or is skipped but then something
  // is found to be invalid on the server, we get that error back
  // as a special Meteor.Error that we need to parse.


  if (Meteor.isClient && hasCallback) {
    callback = args[last] = wrapCallbackForParsingServerErrors(validationContext, callback);
  }

  var schemaAllowsId = schema.allowsKey("_id");

  if (type === "insert" && !doc._id && schemaAllowsId) {
    doc._id = collection._makeNewID();
  } // Get the docId for passing in the autoValue/custom context


  var docId;

  if (type === 'insert') {
    docId = doc._id; // might be undefined
  } else if (type === "update" && selector) {
    docId = typeof selector === 'string' || selector instanceof Mongo.ObjectID ? selector : selector._id;
  } // If _id has already been added, remove it temporarily if it's
  // not explicitly defined in the schema.


  var cachedId;

  if (doc._id && !schemaAllowsId) {
    cachedId = doc._id;
    delete doc._id;
  }

  const autoValueContext = {
    isInsert: type === "insert",
    isUpdate: type === "update" && options.upsert !== true,
    isUpsert,
    userId,
    isFromTrustedCode,
    docId,
    isLocalCollection
  };
  const extendAutoValueContext = (0, _objectSpread2.default)({}, (schema._cleanOptions || {}).extendAutoValueContext || {}, autoValueContext, options.extendAutoValueContext);
  const cleanOptionsForThisOperation = {};
  ["autoConvert", "filter", "removeEmptyStrings", "removeNullsFromArrays", "trimStrings"].forEach(prop => {
    if (typeof options[prop] === "boolean") {
      cleanOptionsForThisOperation[prop] = options[prop];
    }
  }); // Preliminary cleaning on both client and server. On the server and for local
  // collections, automatic values will also be set at this point.

  schema.clean(doc, (0, _objectSpread2.default)({
    mutate: true,
    // Clean the doc/modifier in place
    isModifier: type !== "insert"
  }, defaultCleanOptions, schema._cleanOptions || {}, cleanOptionsForThisOperation, {
    extendAutoValueContext,
    // This was extended separately above
    getAutoValues // Force this override

  })); // We clone before validating because in some cases we need to adjust the
  // object a bit before validating it. If we adjusted `doc` itself, our
  // changes would persist into the database.

  var docToValidate = {};

  for (var prop in doc) {
    // We omit prototype properties when cloning because they will not be valid
    // and mongo omits them when saving to the database anyway.
    if (Object.prototype.hasOwnProperty.call(doc, prop)) {
      docToValidate[prop] = doc[prop];
    }
  } // On the server, upserts are possible; SimpleSchema handles upserts pretty
  // well by default, but it will not know about the fields in the selector,
  // which are also stored in the database if an insert is performed. So we
  // will allow these fields to be considered for validation by adding them
  // to the $set in the modifier. This is no doubt prone to errors, but there
  // probably isn't any better way right now.


  if (Meteor.isServer && isUpsert && isObject(selector)) {
    var set = docToValidate.$set || {}; // If selector uses $and format, convert to plain object selector

    if (Array.isArray(selector.$and)) {
      const plainSelector = {};
      selector.$and.forEach(sel => {
        Object.assign(plainSelector, sel);
      });
      docToValidate.$set = plainSelector;
    } else {
      docToValidate.$set = clone(selector);
    }

    if (!schemaAllowsId) delete docToValidate.$set._id;
    Object.assign(docToValidate.$set, set);
  } // Set automatic values for validation on the client.
  // On the server, we already updated doc with auto values, but on the client,
  // we will add them to docToValidate for validation purposes only.
  // This is because we want all actual values generated on the server.


  if (Meteor.isClient && !isLocalCollection) {
    schema.clean(docToValidate, {
      autoConvert: false,
      extendAutoValueContext,
      filter: false,
      getAutoValues: true,
      isModifier: type !== "insert",
      mutate: true,
      // Clean the doc/modifier in place
      removeEmptyStrings: false,
      removeNullsFromArrays: false,
      trimStrings: false
    });
  } // XXX Maybe move this into SimpleSchema


  if (!validatedObjectWasInitiallyEmpty && isEmpty(docToValidate)) {
    throw new Error('After filtering out keys not in the schema, your ' + (type === 'update' ? 'modifier' : 'object') + ' is now empty');
  } // Validate doc


  var isValid;

  if (options.validate === false) {
    isValid = true;
  } else {
    isValid = validationContext.validate(docToValidate, {
      modifier: type === "update" || type === "upsert",
      upsert: isUpsert,
      extendedCustomContext: (0, _objectSpread2.default)({
        isInsert: type === "insert",
        isUpdate: type === "update" && options.upsert !== true,
        isUpsert,
        userId,
        isFromTrustedCode,
        docId,
        isLocalCollection
      }, options.extendedCustomContext || {})
    });
  }

  if (isValid) {
    // Add the ID back
    if (cachedId) {
      doc._id = cachedId;
    } // Update the args to reflect the cleaned doc
    // XXX not sure this is necessary since we mutate


    if (type === "insert") {
      args[0] = doc;
    } else {
      args[1] = doc;
    } // If callback, set invalidKey when we get a mongo unique error


    if (Meteor.isServer && hasCallback) {
      args[last] = wrapCallbackForParsingMongoValidationErrors(validationContext, args[last]);
    }

    return args;
  } else {
    error = getErrorObject(validationContext, `in ${collection._name} ${type}`);

    if (callback) {
      // insert/update/upsert pass `false` when there's an error, so we do that
      callback(error, false);
    } else {
      throw error;
    }
  }
}

function getErrorObject(context, appendToMessage = '') {
  let message;
  const invalidKeys = typeof context.validationErrors === 'function' ? context.validationErrors() : context.invalidKeys();

  if (invalidKeys.length) {
    const firstErrorKey = invalidKeys[0].name;
    const firstErrorMessage = context.keyErrorMessage(firstErrorKey); // If the error is in a nested key, add the full key to the error message
    // to be more helpful.

    if (firstErrorKey.indexOf('.') === -1) {
      message = firstErrorMessage;
    } else {
      message = `${firstErrorMessage} (${firstErrorKey})`;
    }
  } else {
    message = "Failed validation";
  }

  message = `${message} ${appendToMessage}`.trim();
  const error = new Error(message);
  error.invalidKeys = invalidKeys;
  error.validationContext = context; // If on the server, we add a sanitized error, too, in case we're
  // called from a method.

  if (Meteor.isServer) {
    error.sanitizedError = new Meteor.Error(400, message, EJSON.stringify(error.invalidKeys));
  }

  return error;
}

function addUniqueError(context, errorMessage) {
  var name = errorMessage.split('c2_')[1].split(' ')[0];
  var val = errorMessage.split('dup key:')[1].split('"')[1];
  var addValidationErrorsPropName = typeof context.addValidationErrors === 'function' ? 'addValidationErrors' : 'addInvalidKeys';
  context[addValidationErrorsPropName]([{
    name: name,
    type: 'notUnique',
    value: val
  }]);
}

function wrapCallbackForParsingMongoValidationErrors(validationContext, cb) {
  return function wrappedCallbackForParsingMongoValidationErrors(...args) {
    const error = args[0];

    if (error && (error.name === "MongoError" && error.code === 11001 || error.message.indexOf('MongoError: E11000' !== -1)) && error.message.indexOf('c2_') !== -1) {
      addUniqueError(validationContext, error.message);
      args[0] = getErrorObject(validationContext);
    }

    return cb.apply(this, args);
  };
}

function wrapCallbackForParsingServerErrors(validationContext, cb) {
  var addValidationErrorsPropName = typeof validationContext.addValidationErrors === 'function' ? 'addValidationErrors' : 'addInvalidKeys';
  return function wrappedCallbackForParsingServerErrors(...args) {
    const error = args[0]; // Handle our own validation errors

    if (error instanceof Meteor.Error && error.error === 400 && error.reason === "INVALID" && typeof error.details === "string") {
      var invalidKeysFromServer = EJSON.parse(error.details);
      validationContext[addValidationErrorsPropName](invalidKeysFromServer);
      args[0] = getErrorObject(validationContext);
    } // Handle Mongo unique index errors, which are forwarded to the client as 409 errors
    else if (error instanceof Meteor.Error && error.error === 409 && error.reason && error.reason.indexOf('E11000') !== -1 && error.reason.indexOf('c2_') !== -1) {
        addUniqueError(validationContext, error.reason);
        args[0] = getErrorObject(validationContext);
      }

    return cb.apply(this, args);
  };
}

var alreadyInsecured = {};

function keepInsecure(c) {
  // If insecure package is in use, we need to add allow rules that return
  // true. Otherwise, it would seemingly turn off insecure mode.
  if (Package && Package.insecure && !alreadyInsecured[c._name]) {
    c.allow({
      insert: function () {
        return true;
      },
      update: function () {
        return true;
      },
      remove: function () {
        return true;
      },
      fetch: [],
      transform: null
    });
    alreadyInsecured[c._name] = true;
  } // If insecure package is NOT in use, then adding the two deny functions
  // does not have any effect on the main app's security paradigm. The
  // user will still be required to add at least one allow function of her
  // own for each operation for this collection. And the user may still add
  // additional deny functions, but does not have to.

}

var alreadyDefined = {};

function defineDeny(c, options) {
  if (!alreadyDefined[c._name]) {
    var isLocalCollection = c._connection === null; // First define deny functions to extend doc with the results of clean
    // and autovalues. This must be done with "transform: null" or we would be
    // extending a clone of doc and therefore have no effect.

    c.deny({
      insert: function (userId, doc) {
        // Referenced doc is cleaned in place
        c.simpleSchema(doc).clean(doc, {
          mutate: true,
          isModifier: false,
          // We don't do these here because they are done on the client if desired
          filter: false,
          autoConvert: false,
          removeEmptyStrings: false,
          trimStrings: false,
          extendAutoValueContext: {
            isInsert: true,
            isUpdate: false,
            isUpsert: false,
            userId: userId,
            isFromTrustedCode: false,
            docId: doc._id,
            isLocalCollection: isLocalCollection
          }
        });
        return false;
      },
      update: function (userId, doc, fields, modifier) {
        // Referenced modifier is cleaned in place
        c.simpleSchema(modifier).clean(modifier, {
          mutate: true,
          isModifier: true,
          // We don't do these here because they are done on the client if desired
          filter: false,
          autoConvert: false,
          removeEmptyStrings: false,
          trimStrings: false,
          extendAutoValueContext: {
            isInsert: false,
            isUpdate: true,
            isUpsert: false,
            userId: userId,
            isFromTrustedCode: false,
            docId: doc && doc._id,
            isLocalCollection: isLocalCollection
          }
        });
        return false;
      },
      fetch: ['_id'],
      transform: null
    }); // Second define deny functions to validate again on the server
    // for client-initiated inserts and updates. These should be
    // called after the clean/autovalue functions since we're adding
    // them after. These must *not* have "transform: null" if options.transform is true because
    // we need to pass the doc through any transforms to be sure
    // that custom types are properly recognized for type validation.

    c.deny((0, _objectSpread2.default)({
      insert: function (userId, doc) {
        // We pass the false options because we will have done them on client if desired
        doValidate(c, "insert", [doc, {
          trimStrings: false,
          removeEmptyStrings: false,
          filter: false,
          autoConvert: false
        }, function (error) {
          if (error) {
            throw new Meteor.Error(400, 'INVALID', EJSON.stringify(error.invalidKeys));
          }
        }], false, // getAutoValues
        userId, false // isFromTrustedCode
        );
        return false;
      },
      update: function (userId, doc, fields, modifier) {
        // NOTE: This will never be an upsert because client-side upserts
        // are not allowed once you define allow/deny functions.
        // We pass the false options because we will have done them on client if desired
        doValidate(c, "update", [{
          _id: doc && doc._id
        }, modifier, {
          trimStrings: false,
          removeEmptyStrings: false,
          filter: false,
          autoConvert: false
        }, function (error) {
          if (error) {
            throw new Meteor.Error(400, 'INVALID', EJSON.stringify(error.invalidKeys));
          }
        }], false, // getAutoValues
        userId, false // isFromTrustedCode
        );
        return false;
      },
      fetch: ['_id']
    }, options.transform === true ? {} : {
      transform: null
    })); // note that we've already done this collection so that we don't do it again
    // if attachSchema is called again

    alreadyDefined[c._name] = true;
  }
}

module.exportDefault(Collection2);
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"node_modules":{"clone":{"package.json":function(require,exports){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// node_modules/meteor/aldeed_collection2/node_modules/clone/package.json                                            //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
exports.name = "clone";
exports.version = "2.1.1";
exports.main = "clone.js";

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"clone.js":function(require,exports,module){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// node_modules/meteor/aldeed_collection2/node_modules/clone/clone.js                                                //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
var clone = (function() {
'use strict';

function _instanceof(obj, type) {
  return type != null && obj instanceof type;
}

var nativeMap;
try {
  nativeMap = Map;
} catch(_) {
  // maybe a reference error because no `Map`. Give it a dummy value that no
  // value will ever be an instanceof.
  nativeMap = function() {};
}

var nativeSet;
try {
  nativeSet = Set;
} catch(_) {
  nativeSet = function() {};
}

var nativePromise;
try {
  nativePromise = Promise;
} catch(_) {
  nativePromise = function() {};
}

/**
 * Clones (copies) an Object using deep copying.
 *
 * This function supports circular references by default, but if you are certain
 * there are no circular references in your object, you can save some CPU time
 * by calling clone(obj, false).
 *
 * Caution: if `circular` is false and `parent` contains circular references,
 * your program may enter an infinite loop and crash.
 *
 * @param `parent` - the object to be cloned
 * @param `circular` - set to true if the object to be cloned may contain
 *    circular references. (optional - true by default)
 * @param `depth` - set to a number if the object is only to be cloned to
 *    a particular depth. (optional - defaults to Infinity)
 * @param `prototype` - sets the prototype to be used when cloning an object.
 *    (optional - defaults to parent prototype).
 * @param `includeNonEnumerable` - set to true if the non-enumerable properties
 *    should be cloned as well. Non-enumerable properties on the prototype
 *    chain will be ignored. (optional - false by default)
*/
function clone(parent, circular, depth, prototype, includeNonEnumerable) {
  if (typeof circular === 'object') {
    depth = circular.depth;
    prototype = circular.prototype;
    includeNonEnumerable = circular.includeNonEnumerable;
    circular = circular.circular;
  }
  // maintain two arrays for circular references, where corresponding parents
  // and children have the same index
  var allParents = [];
  var allChildren = [];

  var useBuffer = typeof Buffer != 'undefined';

  if (typeof circular == 'undefined')
    circular = true;

  if (typeof depth == 'undefined')
    depth = Infinity;

  // recurse this function so we don't reset allParents and allChildren
  function _clone(parent, depth) {
    // cloning null always returns null
    if (parent === null)
      return null;

    if (depth === 0)
      return parent;

    var child;
    var proto;
    if (typeof parent != 'object') {
      return parent;
    }

    if (_instanceof(parent, nativeMap)) {
      child = new nativeMap();
    } else if (_instanceof(parent, nativeSet)) {
      child = new nativeSet();
    } else if (_instanceof(parent, nativePromise)) {
      child = new nativePromise(function (resolve, reject) {
        parent.then(function(value) {
          resolve(_clone(value, depth - 1));
        }, function(err) {
          reject(_clone(err, depth - 1));
        });
      });
    } else if (clone.__isArray(parent)) {
      child = [];
    } else if (clone.__isRegExp(parent)) {
      child = new RegExp(parent.source, __getRegExpFlags(parent));
      if (parent.lastIndex) child.lastIndex = parent.lastIndex;
    } else if (clone.__isDate(parent)) {
      child = new Date(parent.getTime());
    } else if (useBuffer && Buffer.isBuffer(parent)) {
      child = new Buffer(parent.length);
      parent.copy(child);
      return child;
    } else if (_instanceof(parent, Error)) {
      child = Object.create(parent);
    } else {
      if (typeof prototype == 'undefined') {
        proto = Object.getPrototypeOf(parent);
        child = Object.create(proto);
      }
      else {
        child = Object.create(prototype);
        proto = prototype;
      }
    }

    if (circular) {
      var index = allParents.indexOf(parent);

      if (index != -1) {
        return allChildren[index];
      }
      allParents.push(parent);
      allChildren.push(child);
    }

    if (_instanceof(parent, nativeMap)) {
      parent.forEach(function(value, key) {
        var keyChild = _clone(key, depth - 1);
        var valueChild = _clone(value, depth - 1);
        child.set(keyChild, valueChild);
      });
    }
    if (_instanceof(parent, nativeSet)) {
      parent.forEach(function(value) {
        var entryChild = _clone(value, depth - 1);
        child.add(entryChild);
      });
    }

    for (var i in parent) {
      var attrs;
      if (proto) {
        attrs = Object.getOwnPropertyDescriptor(proto, i);
      }

      if (attrs && attrs.set == null) {
        continue;
      }
      child[i] = _clone(parent[i], depth - 1);
    }

    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(parent);
      for (var i = 0; i < symbols.length; i++) {
        // Don't need to worry about cloning a symbol because it is a primitive,
        // like a number or string.
        var symbol = symbols[i];
        var descriptor = Object.getOwnPropertyDescriptor(parent, symbol);
        if (descriptor && !descriptor.enumerable && !includeNonEnumerable) {
          continue;
        }
        child[symbol] = _clone(parent[symbol], depth - 1);
        if (!descriptor.enumerable) {
          Object.defineProperty(child, symbol, {
            enumerable: false
          });
        }
      }
    }

    if (includeNonEnumerable) {
      var allPropertyNames = Object.getOwnPropertyNames(parent);
      for (var i = 0; i < allPropertyNames.length; i++) {
        var propertyName = allPropertyNames[i];
        var descriptor = Object.getOwnPropertyDescriptor(parent, propertyName);
        if (descriptor && descriptor.enumerable) {
          continue;
        }
        child[propertyName] = _clone(parent[propertyName], depth - 1);
        Object.defineProperty(child, propertyName, {
          enumerable: false
        });
      }
    }

    return child;
  }

  return _clone(parent, depth);
}

/**
 * Simple flat clone using prototype, accepts only objects, usefull for property
 * override on FLAT configuration object (no nested props).
 *
 * USE WITH CAUTION! This may not behave as you wish if you do not know how this
 * works.
 */
clone.clonePrototype = function clonePrototype(parent) {
  if (parent === null)
    return null;

  var c = function () {};
  c.prototype = parent;
  return new c();
};

// private utility functions

function __objToStr(o) {
  return Object.prototype.toString.call(o);
}
clone.__objToStr = __objToStr;

function __isDate(o) {
  return typeof o === 'object' && __objToStr(o) === '[object Date]';
}
clone.__isDate = __isDate;

function __isArray(o) {
  return typeof o === 'object' && __objToStr(o) === '[object Array]';
}
clone.__isArray = __isArray;

function __isRegExp(o) {
  return typeof o === 'object' && __objToStr(o) === '[object RegExp]';
}
clone.__isRegExp = __isRegExp;

function __getRegExpFlags(re) {
  var flags = '';
  if (re.global) flags += 'g';
  if (re.ignoreCase) flags += 'i';
  if (re.multiline) flags += 'm';
  return flags;
}
clone.__getRegExpFlags = __getRegExpFlags;

return clone;
})();

if (typeof module === 'object' && module.exports) {
  module.exports = clone;
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"ejson":{"package.json":function(require,exports){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// node_modules/meteor/aldeed_collection2/node_modules/ejson/package.json                                            //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
exports.name = "ejson";
exports.version = "2.1.2";
exports.main = "index.js";

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"index.js":function(require,exports,module){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// node_modules/meteor/aldeed_collection2/node_modules/ejson/index.js                                                //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
module.exports = (function () {
"use strict";
var Meteor = { _noYieldsAllowed:function nope(f) { return f(); }};
var EJSON, EJSONTest, i, Base64, root = {};
var _ = require("underscore");
// Base 64 encoding

var BASE_64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

var BASE_64_VALS = {};

for (var i = 0; i < BASE_64_CHARS.length; i++) {
  BASE_64_VALS[BASE_64_CHARS.charAt(i)] = i;
};

Base64 = {};

Base64.encode = function (array) {

  if (typeof array === "string") {
    var str = array;
    array = Base64.newBinary(str.length);
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      if (ch > 0xFF) {
        throw new Error(
          "Not ascii. Base64.encode can only take ascii strings.");
      }
      array[i] = ch;
    }
  }

  var answer = [];
  var a = null;
  var b = null;
  var c = null;
  var d = null;
  for (var i = 0; i < array.length; i++) {
    switch (i % 3) {
    case 0:
      a = (array[i] >> 2) & 0x3F;
      b = (array[i] & 0x03) << 4;
      break;
    case 1:
      b = b | (array[i] >> 4) & 0xF;
      c = (array[i] & 0xF) << 2;
      break;
    case 2:
      c = c | (array[i] >> 6) & 0x03;
      d = array[i] & 0x3F;
      answer.push(getChar(a));
      answer.push(getChar(b));
      answer.push(getChar(c));
      answer.push(getChar(d));
      a = null;
      b = null;
      c = null;
      d = null;
      break;
    }
  }
  if (a != null) {
    answer.push(getChar(a));
    answer.push(getChar(b));
    if (c == null)
      answer.push('=');
    else
      answer.push(getChar(c));
    if (d == null)
      answer.push('=');
  }
  return answer.join("");
};

var getChar = function (val) {
  return BASE_64_CHARS.charAt(val);
};

var getVal = function (ch) {
  if (ch === '=') {
    return -1;
  }
  return BASE_64_VALS[ch];
};

// XXX This is a weird place for this to live, but it's used both by
// this package and 'ejson', and we can't put it in 'ejson' without
// introducing a circular dependency. It should probably be in its own
// package or as a helper in a package that both 'base64' and 'ejson'
// use.
Base64.newBinary = function (len) {
  if (typeof Uint8Array === 'undefined' || typeof ArrayBuffer === 'undefined') {
    var ret = [];
    for (var i = 0; i < len; i++) {
      ret.push(0);
    }
    ret.$Uint8ArrayPolyfill = true;
    return ret;
  }
  return new Uint8Array(new ArrayBuffer(len));
};

Base64.decode = function (str) {
  var len = Math.floor((str.length*3)/4);
  if (str.charAt(str.length - 1) == '=') {
    len--;
    if (str.charAt(str.length - 2) == '=')
      len--;
  }
  var arr = Base64.newBinary(len);

  var one = null;
  var two = null;
  var three = null;

  var j = 0;

  for (var i = 0; i < str.length; i++) {
    var c = str.charAt(i);
    var v = getVal(c);
    switch (i % 4) {
    case 0:
      if (v < 0)
        throw new Error('invalid base64 string');
      one = v << 2;
      break;
    case 1:
      if (v < 0)
        throw new Error('invalid base64 string');
      one = one | (v >> 4);
      arr[j++] = one;
      two = (v & 0x0F) << 4;
      break;
    case 2:
      if (v >= 0) {
        two = two | (v >> 2);
        arr[j++] = two;
        three = (v & 0x03) << 6;
      }
      break;
    case 3:
      if (v >= 0) {
        arr[j++] = three | v;
      }
      break;
    }
  }
  return arr;
};

/**
 * @namespace
 * @summary Namespace for EJSON functions
 */
EJSON = {};
EJSONTest = {};



// Custom type interface definition
/**
 * @class CustomType
 * @instanceName customType
 * @memberOf EJSON
 * @summary The interface that a class must satisfy to be able to become an
 * EJSON custom type via EJSON.addType.
 */

/**
 * @function typeName
 * @memberOf EJSON.CustomType
 * @summary Return the tag used to identify this type.  This must match the tag used to register this type with [`EJSON.addType`](#ejson_add_type).
 * @locus Anywhere
 * @instance
 */

/**
 * @function toJSONValue
 * @memberOf EJSON.CustomType
 * @summary Serialize this instance into a JSON-compatible value.
 * @locus Anywhere
 * @instance
 */

/**
 * @function clone
 * @memberOf EJSON.CustomType
 * @summary Return a value `r` such that `this.equals(r)` is true, and modifications to `r` do not affect `this` and vice versa.
 * @locus Anywhere
 * @instance
 */

/**
 * @function equals
 * @memberOf EJSON.CustomType
 * @summary Return `true` if `other` has a value equal to `this`; `false` otherwise.
 * @locus Anywhere
 * @param {Object} other Another object to compare this to.
 * @instance
 */


var customTypes = {};
// Add a custom type, using a method of your choice to get to and
// from a basic JSON-able representation.  The factory argument
// is a function of JSON-able --> your object
// The type you add must have:
// - A toJSONValue() method, so that Meteor can serialize it
// - a typeName() method, to show how to look it up in our type table.
// It is okay if these methods are monkey-patched on.
// EJSON.clone will use toJSONValue and the given factory to produce
// a clone, but you may specify a method clone() that will be
// used instead.
// Similarly, EJSON.equals will use toJSONValue to make comparisons,
// but you may provide a method equals() instead.
/**
 * @summary Add a custom datatype to EJSON.
 * @locus Anywhere
 * @param {String} name A tag for your custom type; must be unique among custom data types defined in your project, and must match the result of your type's `typeName` method.
 * @param {Function} factory A function that deserializes a JSON-compatible value into an instance of your type.  This should match the serialization performed by your type's `toJSONValue` method.
 */
EJSON.addType = function (name, factory) {
  if (_.has(customTypes, name))
    throw new Error("Type " + name + " already present");
  customTypes[name] = factory;
};

var isInfOrNan = function (obj) {
  return _.isNaN(obj) || obj === Infinity || obj === -Infinity;
};

var builtinConverters = [
  { // Date
    matchJSONValue: function (obj) {
      return _.has(obj, '$date') && _.size(obj) === 1;
    },
    matchObject: function (obj) {
      return obj instanceof Date;
    },
    toJSONValue: function (obj) {
      return {$date: obj.getTime()};
    },
    fromJSONValue: function (obj) {
      return new Date(obj.$date);
    }
  },
  { // NaN, Inf, -Inf. (These are the only objects with typeof !== 'object'
    // which we match.)
    matchJSONValue: function (obj) {
      return _.has(obj, '$InfNaN') && _.size(obj) === 1;
    },
    matchObject: isInfOrNan,
    toJSONValue: function (obj) {
      var sign;
      if (_.isNaN(obj))
        sign = 0;
      else if (obj === Infinity)
        sign = 1;
      else
        sign = -1;
      return {$InfNaN: sign};
    },
    fromJSONValue: function (obj) {
      return obj.$InfNaN/0;
    }
  },
  { // Binary
    matchJSONValue: function (obj) {
      return _.has(obj, '$binary') && _.size(obj) === 1;
    },
    matchObject: function (obj) {
      return typeof Uint8Array !== 'undefined' && obj instanceof Uint8Array
        || (obj && _.has(obj, '$Uint8ArrayPolyfill'));
    },
    toJSONValue: function (obj) {
      return {$binary: Base64.encode(obj)};
    },
    fromJSONValue: function (obj) {
      return Base64.decode(obj.$binary);
    }
  },
  { // Escaping one level
    matchJSONValue: function (obj) {
      return _.has(obj, '$escape') && _.size(obj) === 1;
    },
    matchObject: function (obj) {
      if (_.isEmpty(obj) || _.size(obj) > 2) {
        return false;
      }
      return _.any(builtinConverters, function (converter) {
        return converter.matchJSONValue(obj);
      });
    },
    toJSONValue: function (obj) {
      var newObj = {};
      _.each(obj, function (value, key) {
        newObj[key] = EJSON.toJSONValue(value);
      });
      return {$escape: newObj};
    },
    fromJSONValue: function (obj) {
      var newObj = {};
      _.each(obj.$escape, function (value, key) {
        newObj[key] = EJSON.fromJSONValue(value);
      });
      return newObj;
    }
  },
  { // Custom
    matchJSONValue: function (obj) {
      return _.has(obj, '$type') && _.has(obj, '$value') && _.size(obj) === 2;
    },
    matchObject: function (obj) {
      return EJSON._isCustomType(obj);
    },
    toJSONValue: function (obj) {
      var jsonValue = Meteor._noYieldsAllowed(function () {
        return obj.toJSONValue();
      });
      return {$type: obj.typeName(), $value: jsonValue};
    },
    fromJSONValue: function (obj) {
      var typeName = obj.$type;
      if (!_.has(customTypes, typeName))
        throw new Error("Custom EJSON type " + typeName + " is not defined");
      var converter = customTypes[typeName];
      return Meteor._noYieldsAllowed(function () {
        return converter(obj.$value);
      });
    }
  }
];

EJSON._isCustomType = function (obj) {
  return obj &&
    typeof obj.toJSONValue === 'function' &&
    typeof obj.typeName === 'function' &&
    _.has(customTypes, obj.typeName());
};

EJSON._getTypes = function () {
  return customTypes;
};

EJSON._getConverters = function () {
  return builtinConverters;
};

// for both arrays and objects, in-place modification.
var adjustTypesToJSONValue =
EJSON._adjustTypesToJSONValue = function (obj) {
  // Is it an atom that we need to adjust?
  if (obj === null)
    return null;
  var maybeChanged = toJSONValueHelper(obj);
  if (maybeChanged !== undefined)
    return maybeChanged;

  // Other atoms are unchanged.
  if (typeof obj !== 'object')
    return obj;

  // Iterate over array or object structure.
  _.each(obj, function (value, key) {
    if (typeof value !== 'object' && value !== undefined &&
        !isInfOrNan(value))
      return; // continue

    var changed = toJSONValueHelper(value);
    if (changed) {
      obj[key] = changed;
      return; // on to the next key
    }
    // if we get here, value is an object but not adjustable
    // at this level.  recurse.
    adjustTypesToJSONValue(value);
  });
  return obj;
};

// Either return the JSON-compatible version of the argument, or undefined (if
// the item isn't itself replaceable, but maybe some fields in it are)
var toJSONValueHelper = function (item) {
  for (var i = 0; i < builtinConverters.length; i++) {
    var converter = builtinConverters[i];
    if (converter.matchObject(item)) {
      return converter.toJSONValue(item);
    }
  }
  return undefined;
};

/**
 * @summary Serialize an EJSON-compatible value into its plain JSON representation.
 * @locus Anywhere
 * @param {EJSON} val A value to serialize to plain JSON.
 */
EJSON.toJSONValue = function (item) {
  var changed = toJSONValueHelper(item);
  if (changed !== undefined)
    return changed;
  if (typeof item === 'object') {
    item = EJSON.clone(item);
    adjustTypesToJSONValue(item);
  }
  return item;
};

// for both arrays and objects. Tries its best to just
// use the object you hand it, but may return something
// different if the object you hand it itself needs changing.
//
var adjustTypesFromJSONValue =
EJSON._adjustTypesFromJSONValue = function (obj) {
  if (obj === null)
    return null;
  var maybeChanged = fromJSONValueHelper(obj);
  if (maybeChanged !== obj)
    return maybeChanged;

  // Other atoms are unchanged.
  if (typeof obj !== 'object')
    return obj;

  _.each(obj, function (value, key) {
    if (typeof value === 'object') {
      var changed = fromJSONValueHelper(value);
      if (value !== changed) {
        obj[key] = changed;
        return;
      }
      // if we get here, value is an object but not adjustable
      // at this level.  recurse.
      adjustTypesFromJSONValue(value);
    }
  });
  return obj;
};

// Either return the argument changed to have the non-json
// rep of itself (the Object version) or the argument itself.

// DOES NOT RECURSE.  For actually getting the fully-changed value, use
// EJSON.fromJSONValue
var fromJSONValueHelper = function (value) {
  if (typeof value === 'object' && value !== null) {
    if (_.size(value) <= 2
        && _.all(value, function (v, k) {
          return typeof k === 'string' && k.substr(0, 1) === '$';
        })) {
      for (var i = 0; i < builtinConverters.length; i++) {
        var converter = builtinConverters[i];
        if (converter.matchJSONValue(value)) {
          return converter.fromJSONValue(value);
        }
      }
    }
  }
  return value;
};

/**
 * @summary Deserialize an EJSON value from its plain JSON representation.
 * @locus Anywhere
 * @param {JSONCompatible} val A value to deserialize into EJSON.
 */
EJSON.fromJSONValue = function (item) {
  var changed = fromJSONValueHelper(item);
  if (changed === item && typeof item === 'object') {
    item = EJSON.clone(item);
    adjustTypesFromJSONValue(item);
    return item;
  } else {
    return changed;
  }
};

/**
 * @summary Serialize a value to a string.

For EJSON values, the serialization fully represents the value. For non-EJSON values, serializes the same way as `JSON.stringify`.
 * @locus Anywhere
 * @param {EJSON} val A value to stringify.
 * @param {Object} [options]
 * @param {Boolean | Integer | String} options.indent Indents objects and arrays for easy readability.  When `true`, indents by 2 spaces; when an integer, indents by that number of spaces; and when a string, uses the string as the indentation pattern.
 * @param {Boolean} options.canonical When `true`, stringifies keys in an object in sorted order.
 */
EJSON.stringify = function (item, options) {
  var json = EJSON.toJSONValue(item);
  if (options && (options.canonical || options.indent)) {
    return EJSON._canonicalStringify(json, options);
  } else {
    return JSON.stringify(json);
  }
};

/**
 * @summary Parse a string into an EJSON value. Throws an error if the string is not valid EJSON.
 * @locus Anywhere
 * @param {String} str A string to parse into an EJSON value.
 */
EJSON.parse = function (item) {
  if (typeof item !== 'string')
    throw new Error("EJSON.parse argument should be a string");
  return EJSON.fromJSONValue(JSON.parse(item));
};

/**
 * @summary Returns true if `x` is a buffer of binary data, as returned from [`EJSON.newBinary`](#ejson_new_binary).
 * @param {Object} x The variable to check.
 * @locus Anywhere
 */
EJSON.isBinary = function (obj) {
  return !!((typeof Uint8Array !== 'undefined' && obj instanceof Uint8Array) ||
    (obj && obj.$Uint8ArrayPolyfill));
};

/**
 * @summary Return true if `a` and `b` are equal to each other.  Return false otherwise.  Uses the `equals` method on `a` if present, otherwise performs a deep comparison.
 * @locus Anywhere
 * @param {EJSON} a
 * @param {EJSON} b
 * @param {Object} [options]
 * @param {Boolean} options.keyOrderSensitive Compare in key sensitive order, if supported by the JavaScript implementation.  For example, `{a: 1, b: 2}` is equal to `{b: 2, a: 1}` only when `keyOrderSensitive` is `false`.  The default is `false`.
 */
EJSON.equals = function (a, b, options) {
  var i;
  var keyOrderSensitive = !!(options && options.keyOrderSensitive);
  if (a === b)
    return true;
  if (_.isNaN(a) && _.isNaN(b))
    return true; // This differs from the IEEE spec for NaN equality, b/c we don't want
                 // anything ever with a NaN to be poisoned from becoming equal to anything.
  if (!a || !b) // if either one is falsy, they'd have to be === to be equal
    return false;
  if (!(typeof a === 'object' && typeof b === 'object'))
    return false;
  if (a instanceof Date && b instanceof Date)
    return a.valueOf() === b.valueOf();
  if (EJSON.isBinary(a) && EJSON.isBinary(b)) {
    if (a.length !== b.length)
      return false;
    for (i = 0; i < a.length; i++) {
      if (a[i] !== b[i])
        return false;
    }
    return true;
  }
  if (typeof (a.equals) === 'function')
    return a.equals(b, options);
  if (typeof (b.equals) === 'function')
    return b.equals(a, options);
  if (a instanceof Array) {
    if (!(b instanceof Array))
      return false;
    if (a.length !== b.length)
      return false;
    for (i = 0; i < a.length; i++) {
      if (!EJSON.equals(a[i], b[i], options))
        return false;
    }
    return true;
  }
  // fallback for custom types that don't implement their own equals
  switch (EJSON._isCustomType(a) + EJSON._isCustomType(b)) {
    case 1: return false;
    case 2: return EJSON.equals(EJSON.toJSONValue(a), EJSON.toJSONValue(b));
  }
  // fall back to structural equality of objects
  var ret;
  if (keyOrderSensitive) {
    var bKeys = [];
    _.each(b, function (val, x) {
        bKeys.push(x);
    });
    i = 0;
    ret = _.all(a, function (val, x) {
      if (i >= bKeys.length) {
        return false;
      }
      if (x !== bKeys[i]) {
        return false;
      }
      if (!EJSON.equals(val, b[bKeys[i]], options)) {
        return false;
      }
      i++;
      return true;
    });
    return ret && i === bKeys.length;
  } else {
    i = 0;
    ret = _.all(a, function (val, key) {
      if (!_.has(b, key)) {
        return false;
      }
      if (!EJSON.equals(val, b[key], options)) {
        return false;
      }
      i++;
      return true;
    });
    return ret && _.size(b) === i;
  }
};

/**
 * @summary Return a deep copy of `val`.
 * @locus Anywhere
 * @param {EJSON} val A value to copy.
 */
EJSON.clone = function (v) {
  var ret;
  if (typeof v !== "object")
    return v;
  if (v === null)
    return null; // null has typeof "object"
  if (v instanceof Date)
    return new Date(v.getTime());
  // RegExps are not really EJSON elements (eg we don't define a serialization
  // for them), but they're immutable anyway, so we can support them in clone.
  if (v instanceof RegExp)
    return v;
  if (EJSON.isBinary(v)) {
    ret = EJSON.newBinary(v.length);
    for (var i = 0; i < v.length; i++) {
      ret[i] = v[i];
    }
    return ret;
  }
  // XXX: Use something better than underscore's isArray
  if (_.isArray(v) || _.isArguments(v)) {
    // For some reason, _.map doesn't work in this context on Opera (weird test
    // failures).
    ret = [];
    for (i = 0; i < v.length; i++)
      ret[i] = EJSON.clone(v[i]);
    return ret;
  }
  // handle general user-defined typed Objects if they have a clone method
  if (typeof v.clone === 'function') {
    return v.clone();
  }
  // handle other custom types
  if (EJSON._isCustomType(v)) {
    return EJSON.fromJSONValue(EJSON.clone(EJSON.toJSONValue(v)), true);
  }
  // handle other objects
  ret = {};
  _.each(v, function (value, key) {
    ret[key] = EJSON.clone(value);
  });
  return ret;
};

/**
 * @summary Allocate a new buffer of binary data that EJSON can serialize.
 * @locus Anywhere
 * @param {Number} size The number of bytes of binary data to allocate.
 */
// EJSON.newBinary is the public documented API for this functionality,
// but the implementation is in the 'base64' package to avoid
// introducing a circular dependency. (If the implementation were here,
// then 'base64' would have to use EJSON.newBinary, and 'ejson' would
// also have to use 'base64'.)
EJSON.newBinary = Base64.newBinary;

// Based on json2.js from https://github.com/douglascrockford/JSON-js
//
//    json2.js
//    2012-10-08
//
//    Public Domain.
//
//    NO WARRANTY EXPRESSED OR IMPLIED. USE AT YOUR OWN RISK.

function quote(string) {
  return JSON.stringify(string);
}

var str = function (key, holder, singleIndent, outerIndent, canonical) {

  // Produce a string from holder[key].

  var i;          // The loop counter.
  var k;          // The member key.
  var v;          // The member value.
  var length;
  var innerIndent = outerIndent;
  var partial;
  var value = holder[key];

  // What happens next depends on the value's type.

  switch (typeof value) {
  case 'string':
    return quote(value);
  case 'number':
    // JSON numbers must be finite. Encode non-finite numbers as null.
    return isFinite(value) ? String(value) : 'null';
  case 'boolean':
    return String(value);
  // If the type is 'object', we might be dealing with an object or an array or
  // null.
  case 'object':
    // Due to a specification blunder in ECMAScript, typeof null is 'object',
    // so watch out for that case.
    if (!value) {
      return 'null';
    }
    // Make an array to hold the partial results of stringifying this object value.
    innerIndent = outerIndent + singleIndent;
    partial = [];

    // Is the value an array?
    if (_.isArray(value) || _.isArguments(value)) {

      // The value is an array. Stringify every element. Use null as a placeholder
      // for non-JSON values.

      length = value.length;
      for (i = 0; i < length; i += 1) {
        partial[i] = str(i, value, singleIndent, innerIndent, canonical) || 'null';
      }

      // Join all of the elements together, separated with commas, and wrap them in
      // brackets.

      if (partial.length === 0) {
        v = '[]';
      } else if (innerIndent) {
        v = '[\n' + innerIndent + partial.join(',\n' + innerIndent) + '\n' + outerIndent + ']';
      } else {
        v = '[' + partial.join(',') + ']';
      }
      return v;
    }


    // Iterate through all of the keys in the object.
    var keys = _.keys(value);
    if (canonical)
      keys = keys.sort();
    _.each(keys, function (k) {
      v = str(k, value, singleIndent, innerIndent, canonical);
      if (v) {
        partial.push(quote(k) + (innerIndent ? ': ' : ':') + v);
      }
    });


    // Join all of the member texts together, separated with commas,
    // and wrap them in braces.

    if (partial.length === 0) {
      v = '{}';
    } else if (innerIndent) {
      v = '{\n' + innerIndent + partial.join(',\n' + innerIndent) + '\n' + outerIndent + '}';
    } else {
      v = '{' + partial.join(',') + '}';
    }
    return v;
  }
}

// If the JSON object does not yet have a stringify method, give it one.

EJSON._canonicalStringify = function (value, options) {
  // Make a fake root object containing our value under the key of ''.
  // Return the result of stringifying the value.
  options = _.extend({
    indent: "",
    canonical: false
  }, options);
  if (options.indent === true) {
    options.indent = "  ";
  } else if (typeof options.indent === 'number') {
    var newIndent = "";
    for (var i = 0; i < options.indent; i++) {
      newIndent += ' ';
    }
    options.indent = newIndent;
  }
  return str('', {'': value}, options.indent, "", options.canonical);
};

  return EJSON;
}).call(this);
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"lodash.isempty":{"package.json":function(require,exports){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// node_modules/meteor/aldeed_collection2/node_modules/lodash.isempty/package.json                                   //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
exports.name = "lodash.isempty";
exports.version = "4.4.0";

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"index.js":function(require,exports,module){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// node_modules/meteor/aldeed_collection2/node_modules/lodash.isempty/index.js                                       //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
/**
 * lodash (Custom Build) <https://lodash.com/>
 * Build: `lodash modularize exports="npm" -o ./`
 * Copyright jQuery Foundation and other contributors <https://jquery.org/>
 * Released under MIT license <https://lodash.com/license>
 * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
 * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
 */

/** Used as references for various `Number` constants. */
var MAX_SAFE_INTEGER = 9007199254740991;

/** `Object#toString` result references. */
var argsTag = '[object Arguments]',
    funcTag = '[object Function]',
    genTag = '[object GeneratorFunction]',
    mapTag = '[object Map]',
    objectTag = '[object Object]',
    promiseTag = '[object Promise]',
    setTag = '[object Set]',
    weakMapTag = '[object WeakMap]';

var dataViewTag = '[object DataView]';

/**
 * Used to match `RegExp`
 * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
 */
var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;

/** Used to detect host constructors (Safari). */
var reIsHostCtor = /^\[object .+?Constructor\]$/;

/** Detect free variable `global` from Node.js. */
var freeGlobal = typeof global == 'object' && global && global.Object === Object && global;

/** Detect free variable `self`. */
var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

/** Used as a reference to the global object. */
var root = freeGlobal || freeSelf || Function('return this')();

/** Detect free variable `exports`. */
var freeExports = typeof exports == 'object' && exports && !exports.nodeType && exports;

/** Detect free variable `module`. */
var freeModule = freeExports && typeof module == 'object' && module && !module.nodeType && module;

/** Detect the popular CommonJS extension `module.exports`. */
var moduleExports = freeModule && freeModule.exports === freeExports;

/**
 * Gets the value at `key` of `object`.
 *
 * @private
 * @param {Object} [object] The object to query.
 * @param {string} key The key of the property to get.
 * @returns {*} Returns the property value.
 */
function getValue(object, key) {
  return object == null ? undefined : object[key];
}

/**
 * Checks if `value` is a host object in IE < 9.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a host object, else `false`.
 */
function isHostObject(value) {
  // Many host objects are `Object` objects that can coerce to strings
  // despite having improperly defined `toString` methods.
  var result = false;
  if (value != null && typeof value.toString != 'function') {
    try {
      result = !!(value + '');
    } catch (e) {}
  }
  return result;
}

/**
 * Creates a unary function that invokes `func` with its argument transformed.
 *
 * @private
 * @param {Function} func The function to wrap.
 * @param {Function} transform The argument transform.
 * @returns {Function} Returns the new function.
 */
function overArg(func, transform) {
  return function(arg) {
    return func(transform(arg));
  };
}

/** Used for built-in method references. */
var funcProto = Function.prototype,
    objectProto = Object.prototype;

/** Used to detect overreaching core-js shims. */
var coreJsData = root['__core-js_shared__'];

/** Used to detect methods masquerading as native. */
var maskSrcKey = (function() {
  var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || '');
  return uid ? ('Symbol(src)_1.' + uid) : '';
}());

/** Used to resolve the decompiled source of functions. */
var funcToString = funcProto.toString;

/** Used to check objects for own properties. */
var hasOwnProperty = objectProto.hasOwnProperty;

/**
 * Used to resolve the
 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
 * of values.
 */
var objectToString = objectProto.toString;

/** Used to detect if a method is native. */
var reIsNative = RegExp('^' +
  funcToString.call(hasOwnProperty).replace(reRegExpChar, '\\$&')
  .replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
);

/** Built-in value references. */
var Buffer = moduleExports ? root.Buffer : undefined,
    propertyIsEnumerable = objectProto.propertyIsEnumerable;

/* Built-in method references for those with the same name as other `lodash` methods. */
var nativeIsBuffer = Buffer ? Buffer.isBuffer : undefined,
    nativeKeys = overArg(Object.keys, Object);

/* Built-in method references that are verified to be native. */
var DataView = getNative(root, 'DataView'),
    Map = getNative(root, 'Map'),
    Promise = getNative(root, 'Promise'),
    Set = getNative(root, 'Set'),
    WeakMap = getNative(root, 'WeakMap');

/** Detect if properties shadowing those on `Object.prototype` are non-enumerable. */
var nonEnumShadows = !propertyIsEnumerable.call({ 'valueOf': 1 }, 'valueOf');

/** Used to detect maps, sets, and weakmaps. */
var dataViewCtorString = toSource(DataView),
    mapCtorString = toSource(Map),
    promiseCtorString = toSource(Promise),
    setCtorString = toSource(Set),
    weakMapCtorString = toSource(WeakMap);

/**
 * The base implementation of `getTag`.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the `toStringTag`.
 */
function baseGetTag(value) {
  return objectToString.call(value);
}

/**
 * The base implementation of `_.isNative` without bad shim checks.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a native function,
 *  else `false`.
 */
function baseIsNative(value) {
  if (!isObject(value) || isMasked(value)) {
    return false;
  }
  var pattern = (isFunction(value) || isHostObject(value)) ? reIsNative : reIsHostCtor;
  return pattern.test(toSource(value));
}

/**
 * Gets the native function at `key` of `object`.
 *
 * @private
 * @param {Object} object The object to query.
 * @param {string} key The key of the method to get.
 * @returns {*} Returns the function if it's native, else `undefined`.
 */
function getNative(object, key) {
  var value = getValue(object, key);
  return baseIsNative(value) ? value : undefined;
}

/**
 * Gets the `toStringTag` of `value`.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the `toStringTag`.
 */
var getTag = baseGetTag;

// Fallback for data views, maps, sets, and weak maps in IE 11,
// for data views in Edge < 14, and promises in Node.js.
if ((DataView && getTag(new DataView(new ArrayBuffer(1))) != dataViewTag) ||
    (Map && getTag(new Map) != mapTag) ||
    (Promise && getTag(Promise.resolve()) != promiseTag) ||
    (Set && getTag(new Set) != setTag) ||
    (WeakMap && getTag(new WeakMap) != weakMapTag)) {
  getTag = function(value) {
    var result = objectToString.call(value),
        Ctor = result == objectTag ? value.constructor : undefined,
        ctorString = Ctor ? toSource(Ctor) : undefined;

    if (ctorString) {
      switch (ctorString) {
        case dataViewCtorString: return dataViewTag;
        case mapCtorString: return mapTag;
        case promiseCtorString: return promiseTag;
        case setCtorString: return setTag;
        case weakMapCtorString: return weakMapTag;
      }
    }
    return result;
  };
}

/**
 * Checks if `func` has its source masked.
 *
 * @private
 * @param {Function} func The function to check.
 * @returns {boolean} Returns `true` if `func` is masked, else `false`.
 */
function isMasked(func) {
  return !!maskSrcKey && (maskSrcKey in func);
}

/**
 * Checks if `value` is likely a prototype object.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
 */
function isPrototype(value) {
  var Ctor = value && value.constructor,
      proto = (typeof Ctor == 'function' && Ctor.prototype) || objectProto;

  return value === proto;
}

/**
 * Converts `func` to its source code.
 *
 * @private
 * @param {Function} func The function to process.
 * @returns {string} Returns the source code.
 */
function toSource(func) {
  if (func != null) {
    try {
      return funcToString.call(func);
    } catch (e) {}
    try {
      return (func + '');
    } catch (e) {}
  }
  return '';
}

/**
 * Checks if `value` is likely an `arguments` object.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an `arguments` object,
 *  else `false`.
 * @example
 *
 * _.isArguments(function() { return arguments; }());
 * // => true
 *
 * _.isArguments([1, 2, 3]);
 * // => false
 */
function isArguments(value) {
  // Safari 8.1 makes `arguments.callee` enumerable in strict mode.
  return isArrayLikeObject(value) && hasOwnProperty.call(value, 'callee') &&
    (!propertyIsEnumerable.call(value, 'callee') || objectToString.call(value) == argsTag);
}

/**
 * Checks if `value` is classified as an `Array` object.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an array, else `false`.
 * @example
 *
 * _.isArray([1, 2, 3]);
 * // => true
 *
 * _.isArray(document.body.children);
 * // => false
 *
 * _.isArray('abc');
 * // => false
 *
 * _.isArray(_.noop);
 * // => false
 */
var isArray = Array.isArray;

/**
 * Checks if `value` is array-like. A value is considered array-like if it's
 * not a function and has a `value.length` that's an integer greater than or
 * equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is array-like, else `false`.
 * @example
 *
 * _.isArrayLike([1, 2, 3]);
 * // => true
 *
 * _.isArrayLike(document.body.children);
 * // => true
 *
 * _.isArrayLike('abc');
 * // => true
 *
 * _.isArrayLike(_.noop);
 * // => false
 */
function isArrayLike(value) {
  return value != null && isLength(value.length) && !isFunction(value);
}

/**
 * This method is like `_.isArrayLike` except that it also checks if `value`
 * is an object.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an array-like object,
 *  else `false`.
 * @example
 *
 * _.isArrayLikeObject([1, 2, 3]);
 * // => true
 *
 * _.isArrayLikeObject(document.body.children);
 * // => true
 *
 * _.isArrayLikeObject('abc');
 * // => false
 *
 * _.isArrayLikeObject(_.noop);
 * // => false
 */
function isArrayLikeObject(value) {
  return isObjectLike(value) && isArrayLike(value);
}

/**
 * Checks if `value` is a buffer.
 *
 * @static
 * @memberOf _
 * @since 4.3.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
 * @example
 *
 * _.isBuffer(new Buffer(2));
 * // => true
 *
 * _.isBuffer(new Uint8Array(2));
 * // => false
 */
var isBuffer = nativeIsBuffer || stubFalse;

/**
 * Checks if `value` is an empty object, collection, map, or set.
 *
 * Objects are considered empty if they have no own enumerable string keyed
 * properties.
 *
 * Array-like values such as `arguments` objects, arrays, buffers, strings, or
 * jQuery-like collections are considered empty if they have a `length` of `0`.
 * Similarly, maps and sets are considered empty if they have a `size` of `0`.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is empty, else `false`.
 * @example
 *
 * _.isEmpty(null);
 * // => true
 *
 * _.isEmpty(true);
 * // => true
 *
 * _.isEmpty(1);
 * // => true
 *
 * _.isEmpty([1, 2, 3]);
 * // => false
 *
 * _.isEmpty({ 'a': 1 });
 * // => false
 */
function isEmpty(value) {
  if (isArrayLike(value) &&
      (isArray(value) || typeof value == 'string' ||
        typeof value.splice == 'function' || isBuffer(value) || isArguments(value))) {
    return !value.length;
  }
  var tag = getTag(value);
  if (tag == mapTag || tag == setTag) {
    return !value.size;
  }
  if (nonEnumShadows || isPrototype(value)) {
    return !nativeKeys(value).length;
  }
  for (var key in value) {
    if (hasOwnProperty.call(value, key)) {
      return false;
    }
  }
  return true;
}

/**
 * Checks if `value` is classified as a `Function` object.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a function, else `false`.
 * @example
 *
 * _.isFunction(_);
 * // => true
 *
 * _.isFunction(/abc/);
 * // => false
 */
function isFunction(value) {
  // The use of `Object#toString` avoids issues with the `typeof` operator
  // in Safari 8-9 which returns 'object' for typed array and other constructors.
  var tag = isObject(value) ? objectToString.call(value) : '';
  return tag == funcTag || tag == genTag;
}

/**
 * Checks if `value` is a valid array-like length.
 *
 * **Note:** This method is loosely based on
 * [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
 * @example
 *
 * _.isLength(3);
 * // => true
 *
 * _.isLength(Number.MIN_VALUE);
 * // => false
 *
 * _.isLength(Infinity);
 * // => false
 *
 * _.isLength('3');
 * // => false
 */
function isLength(value) {
  return typeof value == 'number' &&
    value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
}

/**
 * Checks if `value` is the
 * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
 * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
 * @example
 *
 * _.isObject({});
 * // => true
 *
 * _.isObject([1, 2, 3]);
 * // => true
 *
 * _.isObject(_.noop);
 * // => true
 *
 * _.isObject(null);
 * // => false
 */
function isObject(value) {
  var type = typeof value;
  return !!value && (type == 'object' || type == 'function');
}

/**
 * Checks if `value` is object-like. A value is object-like if it's not `null`
 * and has a `typeof` result of "object".
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
 * @example
 *
 * _.isObjectLike({});
 * // => true
 *
 * _.isObjectLike([1, 2, 3]);
 * // => true
 *
 * _.isObjectLike(_.noop);
 * // => false
 *
 * _.isObjectLike(null);
 * // => false
 */
function isObjectLike(value) {
  return !!value && typeof value == 'object';
}

/**
 * This method returns `false`.
 *
 * @static
 * @memberOf _
 * @since 4.13.0
 * @category Util
 * @returns {boolean} Returns `false`.
 * @example
 *
 * _.times(2, _.stubFalse);
 * // => [false, false]
 */
function stubFalse() {
  return false;
}

module.exports = isEmpty;

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"lodash.isequal":{"package.json":function(require,exports){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// node_modules/meteor/aldeed_collection2/node_modules/lodash.isequal/package.json                                   //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
exports.name = "lodash.isequal";
exports.version = "4.5.0";

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"index.js":function(require,exports,module){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// node_modules/meteor/aldeed_collection2/node_modules/lodash.isequal/index.js                                       //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
/**
 * Lodash (Custom Build) <https://lodash.com/>
 * Build: `lodash modularize exports="npm" -o ./`
 * Copyright JS Foundation and other contributors <https://js.foundation/>
 * Released under MIT license <https://lodash.com/license>
 * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
 * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
 */

/** Used as the size to enable large array optimizations. */
var LARGE_ARRAY_SIZE = 200;

/** Used to stand-in for `undefined` hash values. */
var HASH_UNDEFINED = '__lodash_hash_undefined__';

/** Used to compose bitmasks for value comparisons. */
var COMPARE_PARTIAL_FLAG = 1,
    COMPARE_UNORDERED_FLAG = 2;

/** Used as references for various `Number` constants. */
var MAX_SAFE_INTEGER = 9007199254740991;

/** `Object#toString` result references. */
var argsTag = '[object Arguments]',
    arrayTag = '[object Array]',
    asyncTag = '[object AsyncFunction]',
    boolTag = '[object Boolean]',
    dateTag = '[object Date]',
    errorTag = '[object Error]',
    funcTag = '[object Function]',
    genTag = '[object GeneratorFunction]',
    mapTag = '[object Map]',
    numberTag = '[object Number]',
    nullTag = '[object Null]',
    objectTag = '[object Object]',
    promiseTag = '[object Promise]',
    proxyTag = '[object Proxy]',
    regexpTag = '[object RegExp]',
    setTag = '[object Set]',
    stringTag = '[object String]',
    symbolTag = '[object Symbol]',
    undefinedTag = '[object Undefined]',
    weakMapTag = '[object WeakMap]';

var arrayBufferTag = '[object ArrayBuffer]',
    dataViewTag = '[object DataView]',
    float32Tag = '[object Float32Array]',
    float64Tag = '[object Float64Array]',
    int8Tag = '[object Int8Array]',
    int16Tag = '[object Int16Array]',
    int32Tag = '[object Int32Array]',
    uint8Tag = '[object Uint8Array]',
    uint8ClampedTag = '[object Uint8ClampedArray]',
    uint16Tag = '[object Uint16Array]',
    uint32Tag = '[object Uint32Array]';

/**
 * Used to match `RegExp`
 * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
 */
var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;

/** Used to detect host constructors (Safari). */
var reIsHostCtor = /^\[object .+?Constructor\]$/;

/** Used to detect unsigned integer values. */
var reIsUint = /^(?:0|[1-9]\d*)$/;

/** Used to identify `toStringTag` values of typed arrays. */
var typedArrayTags = {};
typedArrayTags[float32Tag] = typedArrayTags[float64Tag] =
typedArrayTags[int8Tag] = typedArrayTags[int16Tag] =
typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] =
typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] =
typedArrayTags[uint32Tag] = true;
typedArrayTags[argsTag] = typedArrayTags[arrayTag] =
typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] =
typedArrayTags[dataViewTag] = typedArrayTags[dateTag] =
typedArrayTags[errorTag] = typedArrayTags[funcTag] =
typedArrayTags[mapTag] = typedArrayTags[numberTag] =
typedArrayTags[objectTag] = typedArrayTags[regexpTag] =
typedArrayTags[setTag] = typedArrayTags[stringTag] =
typedArrayTags[weakMapTag] = false;

/** Detect free variable `global` from Node.js. */
var freeGlobal = typeof global == 'object' && global && global.Object === Object && global;

/** Detect free variable `self`. */
var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

/** Used as a reference to the global object. */
var root = freeGlobal || freeSelf || Function('return this')();

/** Detect free variable `exports`. */
var freeExports = typeof exports == 'object' && exports && !exports.nodeType && exports;

/** Detect free variable `module`. */
var freeModule = freeExports && typeof module == 'object' && module && !module.nodeType && module;

/** Detect the popular CommonJS extension `module.exports`. */
var moduleExports = freeModule && freeModule.exports === freeExports;

/** Detect free variable `process` from Node.js. */
var freeProcess = moduleExports && freeGlobal.process;

/** Used to access faster Node.js helpers. */
var nodeUtil = (function() {
  try {
    return freeProcess && freeProcess.binding && freeProcess.binding('util');
  } catch (e) {}
}());

/* Node.js helper references. */
var nodeIsTypedArray = nodeUtil && nodeUtil.isTypedArray;

/**
 * A specialized version of `_.filter` for arrays without support for
 * iteratee shorthands.
 *
 * @private
 * @param {Array} [array] The array to iterate over.
 * @param {Function} predicate The function invoked per iteration.
 * @returns {Array} Returns the new filtered array.
 */
function arrayFilter(array, predicate) {
  var index = -1,
      length = array == null ? 0 : array.length,
      resIndex = 0,
      result = [];

  while (++index < length) {
    var value = array[index];
    if (predicate(value, index, array)) {
      result[resIndex++] = value;
    }
  }
  return result;
}

/**
 * Appends the elements of `values` to `array`.
 *
 * @private
 * @param {Array} array The array to modify.
 * @param {Array} values The values to append.
 * @returns {Array} Returns `array`.
 */
function arrayPush(array, values) {
  var index = -1,
      length = values.length,
      offset = array.length;

  while (++index < length) {
    array[offset + index] = values[index];
  }
  return array;
}

/**
 * A specialized version of `_.some` for arrays without support for iteratee
 * shorthands.
 *
 * @private
 * @param {Array} [array] The array to iterate over.
 * @param {Function} predicate The function invoked per iteration.
 * @returns {boolean} Returns `true` if any element passes the predicate check,
 *  else `false`.
 */
function arraySome(array, predicate) {
  var index = -1,
      length = array == null ? 0 : array.length;

  while (++index < length) {
    if (predicate(array[index], index, array)) {
      return true;
    }
  }
  return false;
}

/**
 * The base implementation of `_.times` without support for iteratee shorthands
 * or max array length checks.
 *
 * @private
 * @param {number} n The number of times to invoke `iteratee`.
 * @param {Function} iteratee The function invoked per iteration.
 * @returns {Array} Returns the array of results.
 */
function baseTimes(n, iteratee) {
  var index = -1,
      result = Array(n);

  while (++index < n) {
    result[index] = iteratee(index);
  }
  return result;
}

/**
 * The base implementation of `_.unary` without support for storing metadata.
 *
 * @private
 * @param {Function} func The function to cap arguments for.
 * @returns {Function} Returns the new capped function.
 */
function baseUnary(func) {
  return function(value) {
    return func(value);
  };
}

/**
 * Checks if a `cache` value for `key` exists.
 *
 * @private
 * @param {Object} cache The cache to query.
 * @param {string} key The key of the entry to check.
 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
 */
function cacheHas(cache, key) {
  return cache.has(key);
}

/**
 * Gets the value at `key` of `object`.
 *
 * @private
 * @param {Object} [object] The object to query.
 * @param {string} key The key of the property to get.
 * @returns {*} Returns the property value.
 */
function getValue(object, key) {
  return object == null ? undefined : object[key];
}

/**
 * Converts `map` to its key-value pairs.
 *
 * @private
 * @param {Object} map The map to convert.
 * @returns {Array} Returns the key-value pairs.
 */
function mapToArray(map) {
  var index = -1,
      result = Array(map.size);

  map.forEach(function(value, key) {
    result[++index] = [key, value];
  });
  return result;
}

/**
 * Creates a unary function that invokes `func` with its argument transformed.
 *
 * @private
 * @param {Function} func The function to wrap.
 * @param {Function} transform The argument transform.
 * @returns {Function} Returns the new function.
 */
function overArg(func, transform) {
  return function(arg) {
    return func(transform(arg));
  };
}

/**
 * Converts `set` to an array of its values.
 *
 * @private
 * @param {Object} set The set to convert.
 * @returns {Array} Returns the values.
 */
function setToArray(set) {
  var index = -1,
      result = Array(set.size);

  set.forEach(function(value) {
    result[++index] = value;
  });
  return result;
}

/** Used for built-in method references. */
var arrayProto = Array.prototype,
    funcProto = Function.prototype,
    objectProto = Object.prototype;

/** Used to detect overreaching core-js shims. */
var coreJsData = root['__core-js_shared__'];

/** Used to resolve the decompiled source of functions. */
var funcToString = funcProto.toString;

/** Used to check objects for own properties. */
var hasOwnProperty = objectProto.hasOwnProperty;

/** Used to detect methods masquerading as native. */
var maskSrcKey = (function() {
  var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || '');
  return uid ? ('Symbol(src)_1.' + uid) : '';
}());

/**
 * Used to resolve the
 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
 * of values.
 */
var nativeObjectToString = objectProto.toString;

/** Used to detect if a method is native. */
var reIsNative = RegExp('^' +
  funcToString.call(hasOwnProperty).replace(reRegExpChar, '\\$&')
  .replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
);

/** Built-in value references. */
var Buffer = moduleExports ? root.Buffer : undefined,
    Symbol = root.Symbol,
    Uint8Array = root.Uint8Array,
    propertyIsEnumerable = objectProto.propertyIsEnumerable,
    splice = arrayProto.splice,
    symToStringTag = Symbol ? Symbol.toStringTag : undefined;

/* Built-in method references for those with the same name as other `lodash` methods. */
var nativeGetSymbols = Object.getOwnPropertySymbols,
    nativeIsBuffer = Buffer ? Buffer.isBuffer : undefined,
    nativeKeys = overArg(Object.keys, Object);

/* Built-in method references that are verified to be native. */
var DataView = getNative(root, 'DataView'),
    Map = getNative(root, 'Map'),
    Promise = getNative(root, 'Promise'),
    Set = getNative(root, 'Set'),
    WeakMap = getNative(root, 'WeakMap'),
    nativeCreate = getNative(Object, 'create');

/** Used to detect maps, sets, and weakmaps. */
var dataViewCtorString = toSource(DataView),
    mapCtorString = toSource(Map),
    promiseCtorString = toSource(Promise),
    setCtorString = toSource(Set),
    weakMapCtorString = toSource(WeakMap);

/** Used to convert symbols to primitives and strings. */
var symbolProto = Symbol ? Symbol.prototype : undefined,
    symbolValueOf = symbolProto ? symbolProto.valueOf : undefined;

/**
 * Creates a hash object.
 *
 * @private
 * @constructor
 * @param {Array} [entries] The key-value pairs to cache.
 */
function Hash(entries) {
  var index = -1,
      length = entries == null ? 0 : entries.length;

  this.clear();
  while (++index < length) {
    var entry = entries[index];
    this.set(entry[0], entry[1]);
  }
}

/**
 * Removes all key-value entries from the hash.
 *
 * @private
 * @name clear
 * @memberOf Hash
 */
function hashClear() {
  this.__data__ = nativeCreate ? nativeCreate(null) : {};
  this.size = 0;
}

/**
 * Removes `key` and its value from the hash.
 *
 * @private
 * @name delete
 * @memberOf Hash
 * @param {Object} hash The hash to modify.
 * @param {string} key The key of the value to remove.
 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
 */
function hashDelete(key) {
  var result = this.has(key) && delete this.__data__[key];
  this.size -= result ? 1 : 0;
  return result;
}

/**
 * Gets the hash value for `key`.
 *
 * @private
 * @name get
 * @memberOf Hash
 * @param {string} key The key of the value to get.
 * @returns {*} Returns the entry value.
 */
function hashGet(key) {
  var data = this.__data__;
  if (nativeCreate) {
    var result = data[key];
    return result === HASH_UNDEFINED ? undefined : result;
  }
  return hasOwnProperty.call(data, key) ? data[key] : undefined;
}

/**
 * Checks if a hash value for `key` exists.
 *
 * @private
 * @name has
 * @memberOf Hash
 * @param {string} key The key of the entry to check.
 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
 */
function hashHas(key) {
  var data = this.__data__;
  return nativeCreate ? (data[key] !== undefined) : hasOwnProperty.call(data, key);
}

/**
 * Sets the hash `key` to `value`.
 *
 * @private
 * @name set
 * @memberOf Hash
 * @param {string} key The key of the value to set.
 * @param {*} value The value to set.
 * @returns {Object} Returns the hash instance.
 */
function hashSet(key, value) {
  var data = this.__data__;
  this.size += this.has(key) ? 0 : 1;
  data[key] = (nativeCreate && value === undefined) ? HASH_UNDEFINED : value;
  return this;
}

// Add methods to `Hash`.
Hash.prototype.clear = hashClear;
Hash.prototype['delete'] = hashDelete;
Hash.prototype.get = hashGet;
Hash.prototype.has = hashHas;
Hash.prototype.set = hashSet;

/**
 * Creates an list cache object.
 *
 * @private
 * @constructor
 * @param {Array} [entries] The key-value pairs to cache.
 */
function ListCache(entries) {
  var index = -1,
      length = entries == null ? 0 : entries.length;

  this.clear();
  while (++index < length) {
    var entry = entries[index];
    this.set(entry[0], entry[1]);
  }
}

/**
 * Removes all key-value entries from the list cache.
 *
 * @private
 * @name clear
 * @memberOf ListCache
 */
function listCacheClear() {
  this.__data__ = [];
  this.size = 0;
}

/**
 * Removes `key` and its value from the list cache.
 *
 * @private
 * @name delete
 * @memberOf ListCache
 * @param {string} key The key of the value to remove.
 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
 */
function listCacheDelete(key) {
  var data = this.__data__,
      index = assocIndexOf(data, key);

  if (index < 0) {
    return false;
  }
  var lastIndex = data.length - 1;
  if (index == lastIndex) {
    data.pop();
  } else {
    splice.call(data, index, 1);
  }
  --this.size;
  return true;
}

/**
 * Gets the list cache value for `key`.
 *
 * @private
 * @name get
 * @memberOf ListCache
 * @param {string} key The key of the value to get.
 * @returns {*} Returns the entry value.
 */
function listCacheGet(key) {
  var data = this.__data__,
      index = assocIndexOf(data, key);

  return index < 0 ? undefined : data[index][1];
}

/**
 * Checks if a list cache value for `key` exists.
 *
 * @private
 * @name has
 * @memberOf ListCache
 * @param {string} key The key of the entry to check.
 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
 */
function listCacheHas(key) {
  return assocIndexOf(this.__data__, key) > -1;
}

/**
 * Sets the list cache `key` to `value`.
 *
 * @private
 * @name set
 * @memberOf ListCache
 * @param {string} key The key of the value to set.
 * @param {*} value The value to set.
 * @returns {Object} Returns the list cache instance.
 */
function listCacheSet(key, value) {
  var data = this.__data__,
      index = assocIndexOf(data, key);

  if (index < 0) {
    ++this.size;
    data.push([key, value]);
  } else {
    data[index][1] = value;
  }
  return this;
}

// Add methods to `ListCache`.
ListCache.prototype.clear = listCacheClear;
ListCache.prototype['delete'] = listCacheDelete;
ListCache.prototype.get = listCacheGet;
ListCache.prototype.has = listCacheHas;
ListCache.prototype.set = listCacheSet;

/**
 * Creates a map cache object to store key-value pairs.
 *
 * @private
 * @constructor
 * @param {Array} [entries] The key-value pairs to cache.
 */
function MapCache(entries) {
  var index = -1,
      length = entries == null ? 0 : entries.length;

  this.clear();
  while (++index < length) {
    var entry = entries[index];
    this.set(entry[0], entry[1]);
  }
}

/**
 * Removes all key-value entries from the map.
 *
 * @private
 * @name clear
 * @memberOf MapCache
 */
function mapCacheClear() {
  this.size = 0;
  this.__data__ = {
    'hash': new Hash,
    'map': new (Map || ListCache),
    'string': new Hash
  };
}

/**
 * Removes `key` and its value from the map.
 *
 * @private
 * @name delete
 * @memberOf MapCache
 * @param {string} key The key of the value to remove.
 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
 */
function mapCacheDelete(key) {
  var result = getMapData(this, key)['delete'](key);
  this.size -= result ? 1 : 0;
  return result;
}

/**
 * Gets the map value for `key`.
 *
 * @private
 * @name get
 * @memberOf MapCache
 * @param {string} key The key of the value to get.
 * @returns {*} Returns the entry value.
 */
function mapCacheGet(key) {
  return getMapData(this, key).get(key);
}

/**
 * Checks if a map value for `key` exists.
 *
 * @private
 * @name has
 * @memberOf MapCache
 * @param {string} key The key of the entry to check.
 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
 */
function mapCacheHas(key) {
  return getMapData(this, key).has(key);
}

/**
 * Sets the map `key` to `value`.
 *
 * @private
 * @name set
 * @memberOf MapCache
 * @param {string} key The key of the value to set.
 * @param {*} value The value to set.
 * @returns {Object} Returns the map cache instance.
 */
function mapCacheSet(key, value) {
  var data = getMapData(this, key),
      size = data.size;

  data.set(key, value);
  this.size += data.size == size ? 0 : 1;
  return this;
}

// Add methods to `MapCache`.
MapCache.prototype.clear = mapCacheClear;
MapCache.prototype['delete'] = mapCacheDelete;
MapCache.prototype.get = mapCacheGet;
MapCache.prototype.has = mapCacheHas;
MapCache.prototype.set = mapCacheSet;

/**
 *
 * Creates an array cache object to store unique values.
 *
 * @private
 * @constructor
 * @param {Array} [values] The values to cache.
 */
function SetCache(values) {
  var index = -1,
      length = values == null ? 0 : values.length;

  this.__data__ = new MapCache;
  while (++index < length) {
    this.add(values[index]);
  }
}

/**
 * Adds `value` to the array cache.
 *
 * @private
 * @name add
 * @memberOf SetCache
 * @alias push
 * @param {*} value The value to cache.
 * @returns {Object} Returns the cache instance.
 */
function setCacheAdd(value) {
  this.__data__.set(value, HASH_UNDEFINED);
  return this;
}

/**
 * Checks if `value` is in the array cache.
 *
 * @private
 * @name has
 * @memberOf SetCache
 * @param {*} value The value to search for.
 * @returns {number} Returns `true` if `value` is found, else `false`.
 */
function setCacheHas(value) {
  return this.__data__.has(value);
}

// Add methods to `SetCache`.
SetCache.prototype.add = SetCache.prototype.push = setCacheAdd;
SetCache.prototype.has = setCacheHas;

/**
 * Creates a stack cache object to store key-value pairs.
 *
 * @private
 * @constructor
 * @param {Array} [entries] The key-value pairs to cache.
 */
function Stack(entries) {
  var data = this.__data__ = new ListCache(entries);
  this.size = data.size;
}

/**
 * Removes all key-value entries from the stack.
 *
 * @private
 * @name clear
 * @memberOf Stack
 */
function stackClear() {
  this.__data__ = new ListCache;
  this.size = 0;
}

/**
 * Removes `key` and its value from the stack.
 *
 * @private
 * @name delete
 * @memberOf Stack
 * @param {string} key The key of the value to remove.
 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
 */
function stackDelete(key) {
  var data = this.__data__,
      result = data['delete'](key);

  this.size = data.size;
  return result;
}

/**
 * Gets the stack value for `key`.
 *
 * @private
 * @name get
 * @memberOf Stack
 * @param {string} key The key of the value to get.
 * @returns {*} Returns the entry value.
 */
function stackGet(key) {
  return this.__data__.get(key);
}

/**
 * Checks if a stack value for `key` exists.
 *
 * @private
 * @name has
 * @memberOf Stack
 * @param {string} key The key of the entry to check.
 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
 */
function stackHas(key) {
  return this.__data__.has(key);
}

/**
 * Sets the stack `key` to `value`.
 *
 * @private
 * @name set
 * @memberOf Stack
 * @param {string} key The key of the value to set.
 * @param {*} value The value to set.
 * @returns {Object} Returns the stack cache instance.
 */
function stackSet(key, value) {
  var data = this.__data__;
  if (data instanceof ListCache) {
    var pairs = data.__data__;
    if (!Map || (pairs.length < LARGE_ARRAY_SIZE - 1)) {
      pairs.push([key, value]);
      this.size = ++data.size;
      return this;
    }
    data = this.__data__ = new MapCache(pairs);
  }
  data.set(key, value);
  this.size = data.size;
  return this;
}

// Add methods to `Stack`.
Stack.prototype.clear = stackClear;
Stack.prototype['delete'] = stackDelete;
Stack.prototype.get = stackGet;
Stack.prototype.has = stackHas;
Stack.prototype.set = stackSet;

/**
 * Creates an array of the enumerable property names of the array-like `value`.
 *
 * @private
 * @param {*} value The value to query.
 * @param {boolean} inherited Specify returning inherited property names.
 * @returns {Array} Returns the array of property names.
 */
function arrayLikeKeys(value, inherited) {
  var isArr = isArray(value),
      isArg = !isArr && isArguments(value),
      isBuff = !isArr && !isArg && isBuffer(value),
      isType = !isArr && !isArg && !isBuff && isTypedArray(value),
      skipIndexes = isArr || isArg || isBuff || isType,
      result = skipIndexes ? baseTimes(value.length, String) : [],
      length = result.length;

  for (var key in value) {
    if ((inherited || hasOwnProperty.call(value, key)) &&
        !(skipIndexes && (
           // Safari 9 has enumerable `arguments.length` in strict mode.
           key == 'length' ||
           // Node.js 0.10 has enumerable non-index properties on buffers.
           (isBuff && (key == 'offset' || key == 'parent')) ||
           // PhantomJS 2 has enumerable non-index properties on typed arrays.
           (isType && (key == 'buffer' || key == 'byteLength' || key == 'byteOffset')) ||
           // Skip index properties.
           isIndex(key, length)
        ))) {
      result.push(key);
    }
  }
  return result;
}

/**
 * Gets the index at which the `key` is found in `array` of key-value pairs.
 *
 * @private
 * @param {Array} array The array to inspect.
 * @param {*} key The key to search for.
 * @returns {number} Returns the index of the matched value, else `-1`.
 */
function assocIndexOf(array, key) {
  var length = array.length;
  while (length--) {
    if (eq(array[length][0], key)) {
      return length;
    }
  }
  return -1;
}

/**
 * The base implementation of `getAllKeys` and `getAllKeysIn` which uses
 * `keysFunc` and `symbolsFunc` to get the enumerable property names and
 * symbols of `object`.
 *
 * @private
 * @param {Object} object The object to query.
 * @param {Function} keysFunc The function to get the keys of `object`.
 * @param {Function} symbolsFunc The function to get the symbols of `object`.
 * @returns {Array} Returns the array of property names and symbols.
 */
function baseGetAllKeys(object, keysFunc, symbolsFunc) {
  var result = keysFunc(object);
  return isArray(object) ? result : arrayPush(result, symbolsFunc(object));
}

/**
 * The base implementation of `getTag` without fallbacks for buggy environments.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the `toStringTag`.
 */
function baseGetTag(value) {
  if (value == null) {
    return value === undefined ? undefinedTag : nullTag;
  }
  return (symToStringTag && symToStringTag in Object(value))
    ? getRawTag(value)
    : objectToString(value);
}

/**
 * The base implementation of `_.isArguments`.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an `arguments` object,
 */
function baseIsArguments(value) {
  return isObjectLike(value) && baseGetTag(value) == argsTag;
}

/**
 * The base implementation of `_.isEqual` which supports partial comparisons
 * and tracks traversed objects.
 *
 * @private
 * @param {*} value The value to compare.
 * @param {*} other The other value to compare.
 * @param {boolean} bitmask The bitmask flags.
 *  1 - Unordered comparison
 *  2 - Partial comparison
 * @param {Function} [customizer] The function to customize comparisons.
 * @param {Object} [stack] Tracks traversed `value` and `other` objects.
 * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
 */
function baseIsEqual(value, other, bitmask, customizer, stack) {
  if (value === other) {
    return true;
  }
  if (value == null || other == null || (!isObjectLike(value) && !isObjectLike(other))) {
    return value !== value && other !== other;
  }
  return baseIsEqualDeep(value, other, bitmask, customizer, baseIsEqual, stack);
}

/**
 * A specialized version of `baseIsEqual` for arrays and objects which performs
 * deep comparisons and tracks traversed objects enabling objects with circular
 * references to be compared.
 *
 * @private
 * @param {Object} object The object to compare.
 * @param {Object} other The other object to compare.
 * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
 * @param {Function} customizer The function to customize comparisons.
 * @param {Function} equalFunc The function to determine equivalents of values.
 * @param {Object} [stack] Tracks traversed `object` and `other` objects.
 * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
 */
function baseIsEqualDeep(object, other, bitmask, customizer, equalFunc, stack) {
  var objIsArr = isArray(object),
      othIsArr = isArray(other),
      objTag = objIsArr ? arrayTag : getTag(object),
      othTag = othIsArr ? arrayTag : getTag(other);

  objTag = objTag == argsTag ? objectTag : objTag;
  othTag = othTag == argsTag ? objectTag : othTag;

  var objIsObj = objTag == objectTag,
      othIsObj = othTag == objectTag,
      isSameTag = objTag == othTag;

  if (isSameTag && isBuffer(object)) {
    if (!isBuffer(other)) {
      return false;
    }
    objIsArr = true;
    objIsObj = false;
  }
  if (isSameTag && !objIsObj) {
    stack || (stack = new Stack);
    return (objIsArr || isTypedArray(object))
      ? equalArrays(object, other, bitmask, customizer, equalFunc, stack)
      : equalByTag(object, other, objTag, bitmask, customizer, equalFunc, stack);
  }
  if (!(bitmask & COMPARE_PARTIAL_FLAG)) {
    var objIsWrapped = objIsObj && hasOwnProperty.call(object, '__wrapped__'),
        othIsWrapped = othIsObj && hasOwnProperty.call(other, '__wrapped__');

    if (objIsWrapped || othIsWrapped) {
      var objUnwrapped = objIsWrapped ? object.value() : object,
          othUnwrapped = othIsWrapped ? other.value() : other;

      stack || (stack = new Stack);
      return equalFunc(objUnwrapped, othUnwrapped, bitmask, customizer, stack);
    }
  }
  if (!isSameTag) {
    return false;
  }
  stack || (stack = new Stack);
  return equalObjects(object, other, bitmask, customizer, equalFunc, stack);
}

/**
 * The base implementation of `_.isNative` without bad shim checks.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a native function,
 *  else `false`.
 */
function baseIsNative(value) {
  if (!isObject(value) || isMasked(value)) {
    return false;
  }
  var pattern = isFunction(value) ? reIsNative : reIsHostCtor;
  return pattern.test(toSource(value));
}

/**
 * The base implementation of `_.isTypedArray` without Node.js optimizations.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
 */
function baseIsTypedArray(value) {
  return isObjectLike(value) &&
    isLength(value.length) && !!typedArrayTags[baseGetTag(value)];
}

/**
 * The base implementation of `_.keys` which doesn't treat sparse arrays as dense.
 *
 * @private
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of property names.
 */
function baseKeys(object) {
  if (!isPrototype(object)) {
    return nativeKeys(object);
  }
  var result = [];
  for (var key in Object(object)) {
    if (hasOwnProperty.call(object, key) && key != 'constructor') {
      result.push(key);
    }
  }
  return result;
}

/**
 * A specialized version of `baseIsEqualDeep` for arrays with support for
 * partial deep comparisons.
 *
 * @private
 * @param {Array} array The array to compare.
 * @param {Array} other The other array to compare.
 * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
 * @param {Function} customizer The function to customize comparisons.
 * @param {Function} equalFunc The function to determine equivalents of values.
 * @param {Object} stack Tracks traversed `array` and `other` objects.
 * @returns {boolean} Returns `true` if the arrays are equivalent, else `false`.
 */
function equalArrays(array, other, bitmask, customizer, equalFunc, stack) {
  var isPartial = bitmask & COMPARE_PARTIAL_FLAG,
      arrLength = array.length,
      othLength = other.length;

  if (arrLength != othLength && !(isPartial && othLength > arrLength)) {
    return false;
  }
  // Assume cyclic values are equal.
  var stacked = stack.get(array);
  if (stacked && stack.get(other)) {
    return stacked == other;
  }
  var index = -1,
      result = true,
      seen = (bitmask & COMPARE_UNORDERED_FLAG) ? new SetCache : undefined;

  stack.set(array, other);
  stack.set(other, array);

  // Ignore non-index properties.
  while (++index < arrLength) {
    var arrValue = array[index],
        othValue = other[index];

    if (customizer) {
      var compared = isPartial
        ? customizer(othValue, arrValue, index, other, array, stack)
        : customizer(arrValue, othValue, index, array, other, stack);
    }
    if (compared !== undefined) {
      if (compared) {
        continue;
      }
      result = false;
      break;
    }
    // Recursively compare arrays (susceptible to call stack limits).
    if (seen) {
      if (!arraySome(other, function(othValue, othIndex) {
            if (!cacheHas(seen, othIndex) &&
                (arrValue === othValue || equalFunc(arrValue, othValue, bitmask, customizer, stack))) {
              return seen.push(othIndex);
            }
          })) {
        result = false;
        break;
      }
    } else if (!(
          arrValue === othValue ||
            equalFunc(arrValue, othValue, bitmask, customizer, stack)
        )) {
      result = false;
      break;
    }
  }
  stack['delete'](array);
  stack['delete'](other);
  return result;
}

/**
 * A specialized version of `baseIsEqualDeep` for comparing objects of
 * the same `toStringTag`.
 *
 * **Note:** This function only supports comparing values with tags of
 * `Boolean`, `Date`, `Error`, `Number`, `RegExp`, or `String`.
 *
 * @private
 * @param {Object} object The object to compare.
 * @param {Object} other The other object to compare.
 * @param {string} tag The `toStringTag` of the objects to compare.
 * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
 * @param {Function} customizer The function to customize comparisons.
 * @param {Function} equalFunc The function to determine equivalents of values.
 * @param {Object} stack Tracks traversed `object` and `other` objects.
 * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
 */
function equalByTag(object, other, tag, bitmask, customizer, equalFunc, stack) {
  switch (tag) {
    case dataViewTag:
      if ((object.byteLength != other.byteLength) ||
          (object.byteOffset != other.byteOffset)) {
        return false;
      }
      object = object.buffer;
      other = other.buffer;

    case arrayBufferTag:
      if ((object.byteLength != other.byteLength) ||
          !equalFunc(new Uint8Array(object), new Uint8Array(other))) {
        return false;
      }
      return true;

    case boolTag:
    case dateTag:
    case numberTag:
      // Coerce booleans to `1` or `0` and dates to milliseconds.
      // Invalid dates are coerced to `NaN`.
      return eq(+object, +other);

    case errorTag:
      return object.name == other.name && object.message == other.message;

    case regexpTag:
    case stringTag:
      // Coerce regexes to strings and treat strings, primitives and objects,
      // as equal. See http://www.ecma-international.org/ecma-262/7.0/#sec-regexp.prototype.tostring
      // for more details.
      return object == (other + '');

    case mapTag:
      var convert = mapToArray;

    case setTag:
      var isPartial = bitmask & COMPARE_PARTIAL_FLAG;
      convert || (convert = setToArray);

      if (object.size != other.size && !isPartial) {
        return false;
      }
      // Assume cyclic values are equal.
      var stacked = stack.get(object);
      if (stacked) {
        return stacked == other;
      }
      bitmask |= COMPARE_UNORDERED_FLAG;

      // Recursively compare objects (susceptible to call stack limits).
      stack.set(object, other);
      var result = equalArrays(convert(object), convert(other), bitmask, customizer, equalFunc, stack);
      stack['delete'](object);
      return result;

    case symbolTag:
      if (symbolValueOf) {
        return symbolValueOf.call(object) == symbolValueOf.call(other);
      }
  }
  return false;
}

/**
 * A specialized version of `baseIsEqualDeep` for objects with support for
 * partial deep comparisons.
 *
 * @private
 * @param {Object} object The object to compare.
 * @param {Object} other The other object to compare.
 * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
 * @param {Function} customizer The function to customize comparisons.
 * @param {Function} equalFunc The function to determine equivalents of values.
 * @param {Object} stack Tracks traversed `object` and `other` objects.
 * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
 */
function equalObjects(object, other, bitmask, customizer, equalFunc, stack) {
  var isPartial = bitmask & COMPARE_PARTIAL_FLAG,
      objProps = getAllKeys(object),
      objLength = objProps.length,
      othProps = getAllKeys(other),
      othLength = othProps.length;

  if (objLength != othLength && !isPartial) {
    return false;
  }
  var index = objLength;
  while (index--) {
    var key = objProps[index];
    if (!(isPartial ? key in other : hasOwnProperty.call(other, key))) {
      return false;
    }
  }
  // Assume cyclic values are equal.
  var stacked = stack.get(object);
  if (stacked && stack.get(other)) {
    return stacked == other;
  }
  var result = true;
  stack.set(object, other);
  stack.set(other, object);

  var skipCtor = isPartial;
  while (++index < objLength) {
    key = objProps[index];
    var objValue = object[key],
        othValue = other[key];

    if (customizer) {
      var compared = isPartial
        ? customizer(othValue, objValue, key, other, object, stack)
        : customizer(objValue, othValue, key, object, other, stack);
    }
    // Recursively compare objects (susceptible to call stack limits).
    if (!(compared === undefined
          ? (objValue === othValue || equalFunc(objValue, othValue, bitmask, customizer, stack))
          : compared
        )) {
      result = false;
      break;
    }
    skipCtor || (skipCtor = key == 'constructor');
  }
  if (result && !skipCtor) {
    var objCtor = object.constructor,
        othCtor = other.constructor;

    // Non `Object` object instances with different constructors are not equal.
    if (objCtor != othCtor &&
        ('constructor' in object && 'constructor' in other) &&
        !(typeof objCtor == 'function' && objCtor instanceof objCtor &&
          typeof othCtor == 'function' && othCtor instanceof othCtor)) {
      result = false;
    }
  }
  stack['delete'](object);
  stack['delete'](other);
  return result;
}

/**
 * Creates an array of own enumerable property names and symbols of `object`.
 *
 * @private
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of property names and symbols.
 */
function getAllKeys(object) {
  return baseGetAllKeys(object, keys, getSymbols);
}

/**
 * Gets the data for `map`.
 *
 * @private
 * @param {Object} map The map to query.
 * @param {string} key The reference key.
 * @returns {*} Returns the map data.
 */
function getMapData(map, key) {
  var data = map.__data__;
  return isKeyable(key)
    ? data[typeof key == 'string' ? 'string' : 'hash']
    : data.map;
}

/**
 * Gets the native function at `key` of `object`.
 *
 * @private
 * @param {Object} object The object to query.
 * @param {string} key The key of the method to get.
 * @returns {*} Returns the function if it's native, else `undefined`.
 */
function getNative(object, key) {
  var value = getValue(object, key);
  return baseIsNative(value) ? value : undefined;
}

/**
 * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the raw `toStringTag`.
 */
function getRawTag(value) {
  var isOwn = hasOwnProperty.call(value, symToStringTag),
      tag = value[symToStringTag];

  try {
    value[symToStringTag] = undefined;
    var unmasked = true;
  } catch (e) {}

  var result = nativeObjectToString.call(value);
  if (unmasked) {
    if (isOwn) {
      value[symToStringTag] = tag;
    } else {
      delete value[symToStringTag];
    }
  }
  return result;
}

/**
 * Creates an array of the own enumerable symbols of `object`.
 *
 * @private
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of symbols.
 */
var getSymbols = !nativeGetSymbols ? stubArray : function(object) {
  if (object == null) {
    return [];
  }
  object = Object(object);
  return arrayFilter(nativeGetSymbols(object), function(symbol) {
    return propertyIsEnumerable.call(object, symbol);
  });
};

/**
 * Gets the `toStringTag` of `value`.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the `toStringTag`.
 */
var getTag = baseGetTag;

// Fallback for data views, maps, sets, and weak maps in IE 11 and promises in Node.js < 6.
if ((DataView && getTag(new DataView(new ArrayBuffer(1))) != dataViewTag) ||
    (Map && getTag(new Map) != mapTag) ||
    (Promise && getTag(Promise.resolve()) != promiseTag) ||
    (Set && getTag(new Set) != setTag) ||
    (WeakMap && getTag(new WeakMap) != weakMapTag)) {
  getTag = function(value) {
    var result = baseGetTag(value),
        Ctor = result == objectTag ? value.constructor : undefined,
        ctorString = Ctor ? toSource(Ctor) : '';

    if (ctorString) {
      switch (ctorString) {
        case dataViewCtorString: return dataViewTag;
        case mapCtorString: return mapTag;
        case promiseCtorString: return promiseTag;
        case setCtorString: return setTag;
        case weakMapCtorString: return weakMapTag;
      }
    }
    return result;
  };
}

/**
 * Checks if `value` is a valid array-like index.
 *
 * @private
 * @param {*} value The value to check.
 * @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
 * @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
 */
function isIndex(value, length) {
  length = length == null ? MAX_SAFE_INTEGER : length;
  return !!length &&
    (typeof value == 'number' || reIsUint.test(value)) &&
    (value > -1 && value % 1 == 0 && value < length);
}

/**
 * Checks if `value` is suitable for use as unique object key.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is suitable, else `false`.
 */
function isKeyable(value) {
  var type = typeof value;
  return (type == 'string' || type == 'number' || type == 'symbol' || type == 'boolean')
    ? (value !== '__proto__')
    : (value === null);
}

/**
 * Checks if `func` has its source masked.
 *
 * @private
 * @param {Function} func The function to check.
 * @returns {boolean} Returns `true` if `func` is masked, else `false`.
 */
function isMasked(func) {
  return !!maskSrcKey && (maskSrcKey in func);
}

/**
 * Checks if `value` is likely a prototype object.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
 */
function isPrototype(value) {
  var Ctor = value && value.constructor,
      proto = (typeof Ctor == 'function' && Ctor.prototype) || objectProto;

  return value === proto;
}

/**
 * Converts `value` to a string using `Object.prototype.toString`.
 *
 * @private
 * @param {*} value The value to convert.
 * @returns {string} Returns the converted string.
 */
function objectToString(value) {
  return nativeObjectToString.call(value);
}

/**
 * Converts `func` to its source code.
 *
 * @private
 * @param {Function} func The function to convert.
 * @returns {string} Returns the source code.
 */
function toSource(func) {
  if (func != null) {
    try {
      return funcToString.call(func);
    } catch (e) {}
    try {
      return (func + '');
    } catch (e) {}
  }
  return '';
}

/**
 * Performs a
 * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
 * comparison between two values to determine if they are equivalent.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to compare.
 * @param {*} other The other value to compare.
 * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
 * @example
 *
 * var object = { 'a': 1 };
 * var other = { 'a': 1 };
 *
 * _.eq(object, object);
 * // => true
 *
 * _.eq(object, other);
 * // => false
 *
 * _.eq('a', 'a');
 * // => true
 *
 * _.eq('a', Object('a'));
 * // => false
 *
 * _.eq(NaN, NaN);
 * // => true
 */
function eq(value, other) {
  return value === other || (value !== value && other !== other);
}

/**
 * Checks if `value` is likely an `arguments` object.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an `arguments` object,
 *  else `false`.
 * @example
 *
 * _.isArguments(function() { return arguments; }());
 * // => true
 *
 * _.isArguments([1, 2, 3]);
 * // => false
 */
var isArguments = baseIsArguments(function() { return arguments; }()) ? baseIsArguments : function(value) {
  return isObjectLike(value) && hasOwnProperty.call(value, 'callee') &&
    !propertyIsEnumerable.call(value, 'callee');
};

/**
 * Checks if `value` is classified as an `Array` object.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an array, else `false`.
 * @example
 *
 * _.isArray([1, 2, 3]);
 * // => true
 *
 * _.isArray(document.body.children);
 * // => false
 *
 * _.isArray('abc');
 * // => false
 *
 * _.isArray(_.noop);
 * // => false
 */
var isArray = Array.isArray;

/**
 * Checks if `value` is array-like. A value is considered array-like if it's
 * not a function and has a `value.length` that's an integer greater than or
 * equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is array-like, else `false`.
 * @example
 *
 * _.isArrayLike([1, 2, 3]);
 * // => true
 *
 * _.isArrayLike(document.body.children);
 * // => true
 *
 * _.isArrayLike('abc');
 * // => true
 *
 * _.isArrayLike(_.noop);
 * // => false
 */
function isArrayLike(value) {
  return value != null && isLength(value.length) && !isFunction(value);
}

/**
 * Checks if `value` is a buffer.
 *
 * @static
 * @memberOf _
 * @since 4.3.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
 * @example
 *
 * _.isBuffer(new Buffer(2));
 * // => true
 *
 * _.isBuffer(new Uint8Array(2));
 * // => false
 */
var isBuffer = nativeIsBuffer || stubFalse;

/**
 * Performs a deep comparison between two values to determine if they are
 * equivalent.
 *
 * **Note:** This method supports comparing arrays, array buffers, booleans,
 * date objects, error objects, maps, numbers, `Object` objects, regexes,
 * sets, strings, symbols, and typed arrays. `Object` objects are compared
 * by their own, not inherited, enumerable properties. Functions and DOM
 * nodes are compared by strict equality, i.e. `===`.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to compare.
 * @param {*} other The other value to compare.
 * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
 * @example
 *
 * var object = { 'a': 1 };
 * var other = { 'a': 1 };
 *
 * _.isEqual(object, other);
 * // => true
 *
 * object === other;
 * // => false
 */
function isEqual(value, other) {
  return baseIsEqual(value, other);
}

/**
 * Checks if `value` is classified as a `Function` object.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a function, else `false`.
 * @example
 *
 * _.isFunction(_);
 * // => true
 *
 * _.isFunction(/abc/);
 * // => false
 */
function isFunction(value) {
  if (!isObject(value)) {
    return false;
  }
  // The use of `Object#toString` avoids issues with the `typeof` operator
  // in Safari 9 which returns 'object' for typed arrays and other constructors.
  var tag = baseGetTag(value);
  return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
}

/**
 * Checks if `value` is a valid array-like length.
 *
 * **Note:** This method is loosely based on
 * [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
 * @example
 *
 * _.isLength(3);
 * // => true
 *
 * _.isLength(Number.MIN_VALUE);
 * // => false
 *
 * _.isLength(Infinity);
 * // => false
 *
 * _.isLength('3');
 * // => false
 */
function isLength(value) {
  return typeof value == 'number' &&
    value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
}

/**
 * Checks if `value` is the
 * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
 * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
 * @example
 *
 * _.isObject({});
 * // => true
 *
 * _.isObject([1, 2, 3]);
 * // => true
 *
 * _.isObject(_.noop);
 * // => true
 *
 * _.isObject(null);
 * // => false
 */
function isObject(value) {
  var type = typeof value;
  return value != null && (type == 'object' || type == 'function');
}

/**
 * Checks if `value` is object-like. A value is object-like if it's not `null`
 * and has a `typeof` result of "object".
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
 * @example
 *
 * _.isObjectLike({});
 * // => true
 *
 * _.isObjectLike([1, 2, 3]);
 * // => true
 *
 * _.isObjectLike(_.noop);
 * // => false
 *
 * _.isObjectLike(null);
 * // => false
 */
function isObjectLike(value) {
  return value != null && typeof value == 'object';
}

/**
 * Checks if `value` is classified as a typed array.
 *
 * @static
 * @memberOf _
 * @since 3.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
 * @example
 *
 * _.isTypedArray(new Uint8Array);
 * // => true
 *
 * _.isTypedArray([]);
 * // => false
 */
var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;

/**
 * Creates an array of the own enumerable property names of `object`.
 *
 * **Note:** Non-object values are coerced to objects. See the
 * [ES spec](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
 * for more details.
 *
 * @static
 * @since 0.1.0
 * @memberOf _
 * @category Object
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of property names.
 * @example
 *
 * function Foo() {
 *   this.a = 1;
 *   this.b = 2;
 * }
 *
 * Foo.prototype.c = 3;
 *
 * _.keys(new Foo);
 * // => ['a', 'b'] (iteration order is not guaranteed)
 *
 * _.keys('hi');
 * // => ['0', '1']
 */
function keys(object) {
  return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);
}

/**
 * This method returns a new empty array.
 *
 * @static
 * @memberOf _
 * @since 4.13.0
 * @category Util
 * @returns {Array} Returns the new empty array.
 * @example
 *
 * var arrays = _.times(2, _.stubArray);
 *
 * console.log(arrays);
 * // => [[], []]
 *
 * console.log(arrays[0] === arrays[1]);
 * // => false
 */
function stubArray() {
  return [];
}

/**
 * This method returns `false`.
 *
 * @static
 * @memberOf _
 * @since 4.13.0
 * @category Util
 * @returns {boolean} Returns `false`.
 * @example
 *
 * _.times(2, _.stubFalse);
 * // => [false, false]
 */
function stubFalse() {
  return false;
}

module.exports = isEqual;

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"lodash.isobject":{"package.json":function(require,exports){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// node_modules/meteor/aldeed_collection2/node_modules/lodash.isobject/package.json                                  //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
exports.name = "lodash.isobject";
exports.version = "3.0.2";

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"index.js":function(require,exports,module){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// node_modules/meteor/aldeed_collection2/node_modules/lodash.isobject/index.js                                      //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
/**
 * lodash 3.0.2 (Custom Build) <https://lodash.com/>
 * Build: `lodash modern modularize exports="npm" -o ./`
 * Copyright 2012-2015 The Dojo Foundation <http://dojofoundation.org/>
 * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
 * Copyright 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
 * Available under MIT license <https://lodash.com/license>
 */

/**
 * Checks if `value` is the [language type](https://es5.github.io/#x8) of `Object`.
 * (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
 *
 * @static
 * @memberOf _
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
 * @example
 *
 * _.isObject({});
 * // => true
 *
 * _.isObject([1, 2, 3]);
 * // => true
 *
 * _.isObject(1);
 * // => false
 */
function isObject(value) {
  // Avoid a V8 JIT bug in Chrome 19-20.
  // See https://code.google.com/p/v8/issues/detail?id=2291 for more details.
  var type = typeof value;
  return !!value && (type == 'object' || type == 'function');
}

module.exports = isObject;

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});
var exports = require("/node_modules/meteor/aldeed:collection2/collection2.js");

/* Exports */
Package._define("aldeed:collection2", exports, {
  Collection2: Collection2
});

})();

//# sourceURL=meteor://💻app/packages/aldeed_collection2.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvYWxkZWVkOmNvbGxlY3Rpb24yL2NvbGxlY3Rpb24yLmpzIl0sIm5hbWVzIjpbIkV2ZW50RW1pdHRlciIsIm1vZHVsZSIsIndhdGNoIiwicmVxdWlyZSIsInYiLCJNZXRlb3IiLCJNb25nbyIsImNoZWNrTnBtVmVyc2lvbnMiLCJjbG9uZSIsImRlZmF1bHQiLCJFSlNPTiIsImlzRW1wdHkiLCJpc0VxdWFsIiwiaXNPYmplY3QiLCJTaW1wbGVTY2hlbWEiLCJDb2xsZWN0aW9uMiIsImRlZmF1bHRDbGVhbk9wdGlvbnMiLCJmaWx0ZXIiLCJhdXRvQ29udmVydCIsInJlbW92ZUVtcHR5U3RyaW5ncyIsInRyaW1TdHJpbmdzIiwicmVtb3ZlTnVsbHNGcm9tQXJyYXlzIiwiQ29sbGVjdGlvbiIsInByb3RvdHlwZSIsImF0dGFjaFNjaGVtYSIsImMyQXR0YWNoU2NoZW1hIiwic3MiLCJvcHRpb25zIiwiX2MyIiwiX3NpbXBsZVNjaGVtYSIsInJlcGxhY2UiLCJ2ZXJzaW9uIiwibmV3U1MiLCJleHRlbmQiLCJzZWxlY3RvciIsImF0dGFjaFRvIiwib2JqIiwic2NoZW1hSW5kZXgiLCJfc2ltcGxlU2NoZW1hcyIsImZvckVhY2giLCJzY2hlbWEiLCJpbmRleCIsInB1c2giLCJfY29sbGVjdGlvbiIsIkxvY2FsQ29sbGVjdGlvbiIsImRlZmluZURlbnkiLCJrZWVwSW5zZWN1cmUiLCJlbWl0Iiwic2ltcGxlU2NoZW1hIiwiZG9jIiwicXVlcnkiLCJzY2hlbWFzIiwibGVuZ3RoIiwiRXJyb3IiLCJ0YXJnZXQiLCJpIiwiT2JqZWN0Iiwia2V5cyIsInVuZGVmaW5lZCIsIiRzZXQiLCJtZXRob2ROYW1lIiwiX3N1cGVyIiwiYXJncyIsImJ5cGFzc0NvbGxlY3Rpb24yIiwidXNlcklkIiwiZXJyIiwiZG9WYWxpZGF0ZSIsImlzU2VydmVyIiwiX2Nvbm5lY3Rpb24iLCJfbWFrZU5ld0lEIiwic3BsaWNlIiwiYXBwbHkiLCJjb2xsZWN0aW9uIiwidHlwZSIsImdldEF1dG9WYWx1ZXMiLCJpc0Zyb21UcnVzdGVkQ29kZSIsImNhbGxiYWNrIiwiZXJyb3IiLCJpc1Vwc2VydCIsImxhc3QiLCJoYXNDYWxsYmFjayIsInZhbGlkYXRlZE9iamVjdFdhc0luaXRpYWxseUVtcHR5IiwidXBzZXJ0IiwiaXNMb2NhbENvbGxlY3Rpb24iLCJ2YWxpZGF0aW9uQ29udGV4dCIsIm5hbWVkQ29udGV4dCIsImlzQ2xpZW50IiwiX2RlYnVnIiwicmVhc29uIiwic3RhY2siLCJ3cmFwQ2FsbGJhY2tGb3JQYXJzaW5nU2VydmVyRXJyb3JzIiwic2NoZW1hQWxsb3dzSWQiLCJhbGxvd3NLZXkiLCJfaWQiLCJkb2NJZCIsIk9iamVjdElEIiwiY2FjaGVkSWQiLCJhdXRvVmFsdWVDb250ZXh0IiwiaXNJbnNlcnQiLCJpc1VwZGF0ZSIsImV4dGVuZEF1dG9WYWx1ZUNvbnRleHQiLCJfY2xlYW5PcHRpb25zIiwiY2xlYW5PcHRpb25zRm9yVGhpc09wZXJhdGlvbiIsInByb3AiLCJjbGVhbiIsIm11dGF0ZSIsImlzTW9kaWZpZXIiLCJkb2NUb1ZhbGlkYXRlIiwiaGFzT3duUHJvcGVydHkiLCJjYWxsIiwic2V0IiwiQXJyYXkiLCJpc0FycmF5IiwiJGFuZCIsInBsYWluU2VsZWN0b3IiLCJzZWwiLCJhc3NpZ24iLCJpc1ZhbGlkIiwidmFsaWRhdGUiLCJtb2RpZmllciIsImV4dGVuZGVkQ3VzdG9tQ29udGV4dCIsIndyYXBDYWxsYmFja0ZvclBhcnNpbmdNb25nb1ZhbGlkYXRpb25FcnJvcnMiLCJnZXRFcnJvck9iamVjdCIsIl9uYW1lIiwiY29udGV4dCIsImFwcGVuZFRvTWVzc2FnZSIsIm1lc3NhZ2UiLCJpbnZhbGlkS2V5cyIsInZhbGlkYXRpb25FcnJvcnMiLCJmaXJzdEVycm9yS2V5IiwibmFtZSIsImZpcnN0RXJyb3JNZXNzYWdlIiwia2V5RXJyb3JNZXNzYWdlIiwiaW5kZXhPZiIsInRyaW0iLCJzYW5pdGl6ZWRFcnJvciIsInN0cmluZ2lmeSIsImFkZFVuaXF1ZUVycm9yIiwiZXJyb3JNZXNzYWdlIiwic3BsaXQiLCJ2YWwiLCJhZGRWYWxpZGF0aW9uRXJyb3JzUHJvcE5hbWUiLCJhZGRWYWxpZGF0aW9uRXJyb3JzIiwidmFsdWUiLCJjYiIsIndyYXBwZWRDYWxsYmFja0ZvclBhcnNpbmdNb25nb1ZhbGlkYXRpb25FcnJvcnMiLCJjb2RlIiwid3JhcHBlZENhbGxiYWNrRm9yUGFyc2luZ1NlcnZlckVycm9ycyIsImRldGFpbHMiLCJpbnZhbGlkS2V5c0Zyb21TZXJ2ZXIiLCJwYXJzZSIsImFscmVhZHlJbnNlY3VyZWQiLCJjIiwiUGFja2FnZSIsImluc2VjdXJlIiwiYWxsb3ciLCJpbnNlcnQiLCJ1cGRhdGUiLCJyZW1vdmUiLCJmZXRjaCIsInRyYW5zZm9ybSIsImFscmVhZHlEZWZpbmVkIiwiZGVueSIsImZpZWxkcyIsImV4cG9ydERlZmF1bHQiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxJQUFJQSxZQUFKO0FBQWlCQyxPQUFPQyxLQUFQLENBQWFDLFFBQVEsMEJBQVIsQ0FBYixFQUFpRDtBQUFDSCxlQUFhSSxDQUFiLEVBQWU7QUFBQ0osbUJBQWFJLENBQWI7QUFBZTs7QUFBaEMsQ0FBakQsRUFBbUYsQ0FBbkY7QUFBc0YsSUFBSUMsTUFBSjtBQUFXSixPQUFPQyxLQUFQLENBQWFDLFFBQVEsZUFBUixDQUFiLEVBQXNDO0FBQUNFLFNBQU9ELENBQVAsRUFBUztBQUFDQyxhQUFPRCxDQUFQO0FBQVM7O0FBQXBCLENBQXRDLEVBQTRELENBQTVEO0FBQStELElBQUlFLEtBQUo7QUFBVUwsT0FBT0MsS0FBUCxDQUFhQyxRQUFRLGNBQVIsQ0FBYixFQUFxQztBQUFDRyxRQUFNRixDQUFOLEVBQVE7QUFBQ0UsWUFBTUYsQ0FBTjtBQUFROztBQUFsQixDQUFyQyxFQUF5RCxDQUF6RDtBQUE0RCxJQUFJRyxnQkFBSjtBQUFxQk4sT0FBT0MsS0FBUCxDQUFhQyxRQUFRLG9DQUFSLENBQWIsRUFBMkQ7QUFBQ0ks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SSxTQUFSLEtBQXNCLElBQXRCLEdBQTZCLEVBQTdCLEdBQWtDO0FBQUNBLGlCQUFXO0FBQVosS0F6RHhDLEdBaEU0QixDQTRINUI7QUFDQTs7QUFDQUMsbUJBQWVULEVBQUU3QixLQUFqQixJQUEwQixJQUExQjtBQUNEO0FBQ0Y7O0FBNXNCRDFILE9BQU9tSyxhQUFQLENBOHNCZXJKLFdBOXNCZixFIiwiZmlsZSI6Ii9wYWNrYWdlcy9hbGRlZWRfY29sbGVjdGlvbjIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBFdmVudEVtaXR0ZXIgfSBmcm9tICdtZXRlb3IvcmFpeDpldmVudGVtaXR0ZXInO1xuaW1wb3J0IHsgTWV0ZW9yIH0gZnJvbSAnbWV0ZW9yL21ldGVvcic7XG5pbXBvcnQgeyBNb25nbyB9IGZyb20gJ21ldGVvci9tb25nbyc7XG5pbXBvcnQgeyBjaGVja05wbVZlcnNpb25zIH0gZnJvbSAnbWV0ZW9yL3RtZWFzZGF5OmNoZWNrLW5wbS12ZXJzaW9ucyc7XG5pbXBvcnQgY2xvbmUgZnJvbSAnY2xvbmUnO1xuaW1wb3J0IEVKU09OIGZyb20gJ2Vqc29uJztcbmltcG9ydCBpc0VtcHR5IGZyb20gJ2xvZGFzaC5pc2VtcHR5JztcbmltcG9ydCBpc0VxdWFsIGZyb20gJ2xvZGFzaC5pc2VxdWFsJztcbmltcG9ydCBpc09iamVjdCBmcm9tICdsb2Rhc2guaXNvYmplY3QnO1xuXG5jaGVja05wbVZlcnNpb25zKHsgJ3NpbXBsLXNjaGVtYSc6ICc+PTAuMC4wJyB9LCAnYWxkZWVkOmNvbGxlY3Rpb24yJyk7XG5cbmNvbnN0IFNpbXBsZVNjaGVtYSA9IHJlcXVpcmUoJ3NpbXBsLXNjaGVtYScpLmRlZmF1bHQ7XG5cbi8vIEV4cG9ydGVkIG9ubHkgZm9yIGxpc3RlbmluZyB0byBldmVudHNcbmNvbnN0IENvbGxlY3Rpb24yID0gbmV3IEV2ZW50RW1pdHRlcigpO1xuXG5jb25zdCBkZWZhdWx0Q2xlYW5PcHRpb25zID0ge1xuICBmaWx0ZXI6IHRydWUsXG4gIGF1dG9Db252ZXJ0OiB0cnVlLFxuICByZW1vdmVFbXB0eVN0cmluZ3M6IHRydWUsXG4gIHRyaW1TdHJpbmdzOiB0cnVlLFxuICByZW1vdmVOdWxsc0Zyb21BcnJheXM6IGZhbHNlLFxufTtcblxuLyoqXG4gKiBNb25nby5Db2xsZWN0aW9uLnByb3RvdHlwZS5hdHRhY2hTY2hlbWFcbiAqIEBwYXJhbSB7U2ltcGxlU2NoZW1hfE9iamVjdH0gc3MgLSBTaW1wbGVTY2hlbWEgaW5zdGFuY2Ugb3IgYSBzY2hlbWEgZGVmaW5pdGlvbiBvYmplY3RcbiAqICAgIGZyb20gd2hpY2ggdG8gY3JlYXRlIGEgbmV3IFNpbXBsZVNjaGVtYSBpbnN0YW5jZVxuICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXVxuICogQHBhcmFtIHtCb29sZWFufSBbb3B0aW9ucy50cmFuc2Zvcm09ZmFsc2VdIFNldCB0byBgdHJ1ZWAgaWYgeW91ciBkb2N1bWVudCBtdXN0IGJlIHBhc3NlZFxuICogICAgdGhyb3VnaCB0aGUgY29sbGVjdGlvbidzIHRyYW5zZm9ybSB0byBwcm9wZXJseSB2YWxpZGF0ZS5cbiAqIEBwYXJhbSB7Qm9vbGVhbn0gW29wdGlvbnMucmVwbGFjZT1mYWxzZV0gU2V0IHRvIGB0cnVlYCB0byByZXBsYWNlIGFueSBleGlzdGluZyBzY2hlbWEgaW5zdGVhZCBvZiBjb21iaW5pbmdcbiAqIEByZXR1cm4ge3VuZGVmaW5lZH1cbiAqXG4gKiBVc2UgdGhpcyBtZXRob2QgdG8gYXR0YWNoIGEgc2NoZW1hIHRvIGEgY29sbGVjdGlvbiBjcmVhdGVkIGJ5IGFub3RoZXIgcGFja2FnZSxcbiAqIHN1Y2ggYXMgTWV0ZW9yLnVzZXJzLiBJdCBpcyBtb3N0IGxpa2VseSB1bnNhZmUgdG8gY2FsbCB0aGlzIG1ldGhvZCBtb3JlIHRoYW5cbiAqIG9uY2UgZm9yIGEgc2luZ2xlIGNvbGxlY3Rpb24sIG9yIHRvIGNhbGwgdGhpcyBmb3IgYSBjb2xsZWN0aW9uIHRoYXQgaGFkIGFcbiAqIHNjaGVtYSBvYmplY3QgcGFzc2VkIHRvIGl0cyBjb25zdHJ1Y3Rvci5cbiAqL1xuTW9uZ28uQ29sbGVjdGlvbi5wcm90b3R5cGUuYXR0YWNoU2NoZW1hID0gZnVuY3Rpb24gYzJBdHRhY2hTY2hlbWEoc3MsIG9wdGlvbnMpIHtcbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgLy8gQWxsb3cgcGFzc2luZyBqdXN0IHRoZSBzY2hlbWEgb2JqZWN0XG4gIGlmICghKHNzIGluc3RhbmNlb2YgU2ltcGxlU2NoZW1hKSkge1xuICAgIHNzID0gbmV3IFNpbXBsZVNjaGVtYShzcyk7XG4gIH1cblxuICB0aGlzLl9jMiA9IHRoaXMuX2MyIHx8IHt9O1xuXG4gIC8vIElmIHdlJ3ZlIGFscmVhZHkgYXR0YWNoZWQgb25lIHNjaGVtYSwgd2UgY29tYmluZSBib3RoIGludG8gYSBuZXcgc2NoZW1hIHVubGVzcyBvcHRpb25zLnJlcGxhY2UgaXMgYHRydWVgXG4gIGlmICh0aGlzLl9jMi5fc2ltcGxlU2NoZW1hICYmIG9wdGlvbnMucmVwbGFjZSAhPT0gdHJ1ZSkge1xuICAgIGlmIChzcy52ZXJzaW9uID49IDIpIHtcbiAgICAgIHZhciBuZXdTUyA9IG5ldyBTaW1wbGVTY2hlbWEodGhpcy5fYzIuX3NpbXBsZVNjaGVtYSk7XG4gICAgICBuZXdTUy5leHRlbmQoc3MpO1xuICAgICAgc3MgPSBuZXdTUztcbiAgICB9IGVsc2Uge1xuICAgICAgc3MgPSBuZXcgU2ltcGxlU2NoZW1hKFt0aGlzLl9jMi5fc2ltcGxlU2NoZW1hLCBzc10pO1xuICAgIH1cbiAgfVxuXG4gIHZhciBzZWxlY3RvciA9IG9wdGlvbnMuc2VsZWN0b3I7XG5cbiAgZnVuY3Rpb24gYXR0YWNoVG8ob2JqKSB7XG4gICAgaWYgKHR5cGVvZiBzZWxlY3RvciA9PT0gXCJvYmplY3RcIikge1xuICAgICAgLy8gSW5kZXggb2YgZXhpc3Rpbmcgc2NoZW1hIHdpdGggaWRlbnRpY2FsIHNlbGVjdG9yXG4gICAgICB2YXIgc2NoZW1hSW5kZXggPSAtMTtcblxuICAgICAgLy8gd2UgbmVlZCBhbiBhcnJheSB0byBob2xkIG11bHRpcGxlIHNjaGVtYXNcbiAgICAgIG9iai5fYzIuX3NpbXBsZVNjaGVtYXMgPSBvYmouX2MyLl9zaW1wbGVTY2hlbWFzIHx8IFtdO1xuXG4gICAgICAvLyBMb29wIHRocm91Z2ggZXhpc3Rpbmcgc2NoZW1hcyB3aXRoIHNlbGVjdG9yc1xuICAgICAgb2JqLl9jMi5fc2ltcGxlU2NoZW1hcy5mb3JFYWNoKChzY2hlbWEsIGluZGV4KSA9PiB7XG4gICAgICAgIC8vIGlmIHdlIGZpbmQgYSBzY2hlbWEgd2l0aCBhbiBpZGVudGljYWwgc2VsZWN0b3IsIHNhdmUgaXQncyBpbmRleFxuICAgICAgICBpZihpc0VxdWFsKHNjaGVtYS5zZWxlY3Rvciwgc2VsZWN0b3IpKSB7XG4gICAgICAgICAgc2NoZW1hSW5kZXggPSBpbmRleDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBpZiAoc2NoZW1hSW5kZXggPT09IC0xKSB7XG4gICAgICAgIC8vIFdlIGRpZG4ndCBmaW5kIHRoZSBzY2hlbWEgaW4gb3VyIGFycmF5IC0gcHVzaCBpdCBpbnRvIHRoZSBhcnJheVxuICAgICAgICBvYmouX2MyLl9zaW1wbGVTY2hlbWFzLnB1c2goe1xuICAgICAgICAgIHNjaGVtYTogbmV3IFNpbXBsZVNjaGVtYShzcyksXG4gICAgICAgICAgc2VsZWN0b3I6IHNlbGVjdG9yLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFdlIGZvdW5kIGEgc2NoZW1hIHdpdGggYW4gaWRlbnRpY2FsIHNlbGVjdG9yIGluIG91ciBhcnJheSxcbiAgICAgICAgaWYgKG9wdGlvbnMucmVwbGFjZSAhPT0gdHJ1ZSkge1xuICAgICAgICAgIC8vIE1lcmdlIHdpdGggZXhpc3Rpbmcgc2NoZW1hIHVubGVzcyBvcHRpb25zLnJlcGxhY2UgaXMgYHRydWVgXG4gICAgICAgICAgaWYgKG9iai5fYzIuX3NpbXBsZVNjaGVtYXNbc2NoZW1hSW5kZXhdLnNjaGVtYS52ZXJzaW9uID49IDIpIHtcbiAgICAgICAgICAgIG9iai5fYzIuX3NpbXBsZVNjaGVtYXNbc2NoZW1hSW5kZXhdLnNjaGVtYS5leHRlbmQoc3MpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBvYmouX2MyLl9zaW1wbGVTY2hlbWFzW3NjaGVtYUluZGV4XS5zY2hlbWEgPSBuZXcgU2ltcGxlU2NoZW1hKFtvYmouX2MyLl9zaW1wbGVTY2hlbWFzW3NjaGVtYUluZGV4XS5zY2hlbWEsIHNzXSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIElmIG9wdGlvbnMucmVwYWxjZSBpcyBgdHJ1ZWAgcmVwbGFjZSBleGlzdGluZyBzY2hlbWEgd2l0aCBuZXcgc2NoZW1hXG4gICAgICAgICAgb2JqLl9jMi5fc2ltcGxlU2NoZW1hc1tzY2hlbWFJbmRleF0uc2NoZW1hID0gc3M7XG4gICAgICAgIH1cblxuICAgICAgfVxuXG4gICAgICAvLyBSZW1vdmUgZXhpc3Rpbmcgc2NoZW1hcyB3aXRob3V0IHNlbGVjdG9yXG4gICAgICBkZWxldGUgb2JqLl9jMi5fc2ltcGxlU2NoZW1hO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBUcmFjayB0aGUgc2NoZW1hIGluIHRoZSBjb2xsZWN0aW9uXG4gICAgICBvYmouX2MyLl9zaW1wbGVTY2hlbWEgPSBzcztcblxuICAgICAgLy8gUmVtb3ZlIGV4aXN0aW5nIHNjaGVtYXMgd2l0aCBzZWxlY3RvclxuICAgICAgZGVsZXRlIG9iai5fYzIuX3NpbXBsZVNjaGVtYXM7XG4gICAgfVxuICB9XG5cbiAgYXR0YWNoVG8odGhpcyk7XG4gIC8vIEF0dGFjaCB0aGUgc2NoZW1hIHRvIHRoZSB1bmRlcmx5aW5nIExvY2FsQ29sbGVjdGlvbiwgdG9vXG4gIGlmICh0aGlzLl9jb2xsZWN0aW9uIGluc3RhbmNlb2YgTG9jYWxDb2xsZWN0aW9uKSB7XG4gICAgdGhpcy5fY29sbGVjdGlvbi5fYzIgPSB0aGlzLl9jb2xsZWN0aW9uLl9jMiB8fCB7fTtcbiAgICBhdHRhY2hUbyh0aGlzLl9jb2xsZWN0aW9uKTtcbiAgfVxuXG4gIGRlZmluZURlbnkodGhpcywgb3B0aW9ucyk7XG4gIGtlZXBJbnNlY3VyZSh0aGlzKTtcblxuICBDb2xsZWN0aW9uMi5lbWl0KCdzY2hlbWEuYXR0YWNoZWQnLCB0aGlzLCBzcywgb3B0aW9ucyk7XG59O1xuXG5bTW9uZ28uQ29sbGVjdGlvbiwgTG9jYWxDb2xsZWN0aW9uXS5mb3JFYWNoKChvYmopID0+IHtcbiAgLyoqXG4gICAqIHNpbXBsZVNjaGVtYVxuICAgKiBAZGVzY3JpcHRpb24gZnVuY3Rpb24gZGV0ZWN0IHRoZSBjb3JyZWN0IHNjaGVtYSBieSBnaXZlbiBwYXJhbXMuIElmIGl0XG4gICAqIGRldGVjdCBtdWx0aS1zY2hlbWEgcHJlc2VuY2UgaW4gdGhlIGNvbGxlY3Rpb24sIHRoZW4gaXQgbWFkZSBhbiBhdHRlbXB0IHRvIGZpbmQgYVxuICAgKiBgc2VsZWN0b3JgIGluIGFyZ3NcbiAgICogQHBhcmFtIHtPYmplY3R9IGRvYyAtIEl0IGNvdWxkIGJlIDx1cGRhdGU+IG9uIHVwZGF0ZS91cHNlcnQgb3IgZG9jdW1lbnRcbiAgICogaXRzZWxmIG9uIGluc2VydC9yZW1vdmVcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXSAtIEl0IGNvdWxkIGJlIDx1cGRhdGU+IG9uIHVwZGF0ZS91cHNlcnQgZXRjXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbcXVlcnldIC0gaXQgY291bGQgYmUgPHF1ZXJ5PiBvbiB1cGRhdGUvdXBzZXJ0XG4gICAqIEByZXR1cm4ge09iamVjdH0gU2NoZW1hXG4gICAqL1xuICBvYmoucHJvdG90eXBlLnNpbXBsZVNjaGVtYSA9IGZ1bmN0aW9uIChkb2MsIG9wdGlvbnMsIHF1ZXJ5KSB7XG4gICAgaWYgKCF0aGlzLl9jMikgcmV0dXJuIG51bGw7XG4gICAgaWYgKHRoaXMuX2MyLl9zaW1wbGVTY2hlbWEpIHJldHVybiB0aGlzLl9jMi5fc2ltcGxlU2NoZW1hO1xuXG4gICAgdmFyIHNjaGVtYXMgPSB0aGlzLl9jMi5fc2ltcGxlU2NoZW1hcztcbiAgICBpZiAoc2NoZW1hcyAmJiBzY2hlbWFzLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmICghZG9jKSB0aHJvdyBuZXcgRXJyb3IoJ2NvbGxlY3Rpb24uc2ltcGxlU2NoZW1hKCkgcmVxdWlyZXMgZG9jIGFyZ3VtZW50IHdoZW4gdGhlcmUgYXJlIG11bHRpcGxlIHNjaGVtYXMnKTtcblxuICAgICAgdmFyIHNjaGVtYSwgc2VsZWN0b3IsIHRhcmdldDtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2NoZW1hcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBzY2hlbWEgPSBzY2hlbWFzW2ldO1xuICAgICAgICBzZWxlY3RvciA9IE9iamVjdC5rZXlzKHNjaGVtYS5zZWxlY3RvcilbMF07XG5cbiAgICAgICAgLy8gV2Ugd2lsbCBzZXQgdGhpcyB0byB1bmRlZmluZWQgYmVjYXVzZSBpbiB0aGVvcnkgeW91IG1pZ2h0IHdhbnQgdG8gc2VsZWN0XG4gICAgICAgIC8vIG9uIGEgbnVsbCB2YWx1ZS5cbiAgICAgICAgdGFyZ2V0ID0gdW5kZWZpbmVkO1xuXG4gICAgICAgIC8vIGhlcmUgd2UgYXJlIGxvb2tpbmcgZm9yIHNlbGVjdG9yIGluIGRpZmZlcmVudCBwbGFjZXNcbiAgICAgICAgLy8gJHNldCBzaG91bGQgaGF2ZSBtb3JlIHByaW9yaXR5IGhlcmVcbiAgICAgICAgaWYgKGRvYy4kc2V0ICYmIHR5cGVvZiBkb2MuJHNldFtzZWxlY3Rvcl0gIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgdGFyZ2V0ID0gZG9jLiRzZXRbc2VsZWN0b3JdO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBkb2Nbc2VsZWN0b3JdICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgIHRhcmdldCA9IGRvY1tzZWxlY3Rvcl07XG4gICAgICAgIH0gZWxzZSBpZiAob3B0aW9ucyAmJiBvcHRpb25zLnNlbGVjdG9yKSB7XG4gICAgICAgICAgdGFyZ2V0ID0gb3B0aW9ucy5zZWxlY3RvcltzZWxlY3Rvcl07XG4gICAgICAgIH0gZWxzZSBpZiAocXVlcnkgJiYgcXVlcnlbc2VsZWN0b3JdKSB7IC8vIG9uIHVwc2VydC91cGRhdGUgb3BlcmF0aW9uc1xuICAgICAgICAgIHRhcmdldCA9IHF1ZXJ5W3NlbGVjdG9yXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHdlIG5lZWQgdG8gY29tcGFyZSBnaXZlbiBzZWxlY3RvciB3aXRoIGRvYyBwcm9wZXJ0eSBvciBvcHRpb24gdG9cbiAgICAgICAgLy8gZmluZCByaWdodCBzY2hlbWFcbiAgICAgICAgaWYgKHRhcmdldCAhPT0gdW5kZWZpbmVkICYmIHRhcmdldCA9PT0gc2NoZW1hLnNlbGVjdG9yW3NlbGVjdG9yXSkge1xuICAgICAgICAgIHJldHVybiBzY2hlbWEuc2NoZW1hO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH07XG59KTtcblxuLy8gV3JhcCBEQiB3cml0ZSBvcGVyYXRpb24gbWV0aG9kc1xuWydpbnNlcnQnLCAndXBkYXRlJ10uZm9yRWFjaCgobWV0aG9kTmFtZSkgPT4ge1xuICBjb25zdCBfc3VwZXIgPSBNb25nby5Db2xsZWN0aW9uLnByb3RvdHlwZVttZXRob2ROYW1lXTtcbiAgTW9uZ28uQ29sbGVjdGlvbi5wcm90b3R5cGVbbWV0aG9kTmFtZV0gPSBmdW5jdGlvbiguLi5hcmdzKSB7XG4gICAgbGV0IG9wdGlvbnMgPSAobWV0aG9kTmFtZSA9PT0gXCJpbnNlcnRcIikgPyBhcmdzWzFdIDogYXJnc1syXTtcblxuICAgIC8vIFN1cHBvcnQgbWlzc2luZyBvcHRpb25zIGFyZ1xuICAgIGlmICghb3B0aW9ucyB8fCB0eXBlb2Ygb3B0aW9ucyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBvcHRpb25zID0ge307XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2MyICYmIG9wdGlvbnMuYnlwYXNzQ29sbGVjdGlvbjIgIT09IHRydWUpIHtcbiAgICAgIHZhciB1c2VySWQgPSBudWxsO1xuICAgICAgdHJ5IHsgLy8gaHR0cHM6Ly9naXRodWIuY29tL2FsZGVlZC9tZXRlb3ItY29sbGVjdGlvbjIvaXNzdWVzLzE3NVxuICAgICAgICB1c2VySWQgPSBNZXRlb3IudXNlcklkKCk7XG4gICAgICB9IGNhdGNoIChlcnIpIHt9XG5cbiAgICAgIGFyZ3MgPSBkb1ZhbGlkYXRlKFxuICAgICAgICB0aGlzLFxuICAgICAgICBtZXRob2ROYW1lLFxuICAgICAgICBhcmdzLFxuICAgICAgICBNZXRlb3IuaXNTZXJ2ZXIgfHwgdGhpcy5fY29ubmVjdGlvbiA9PT0gbnVsbCwgLy8gZ2V0QXV0b1ZhbHVlc1xuICAgICAgICB1c2VySWQsXG4gICAgICAgIE1ldGVvci5pc1NlcnZlciAvLyBpc0Zyb21UcnVzdGVkQ29kZVxuICAgICAgKTtcbiAgICAgIGlmICghYXJncykge1xuICAgICAgICAvLyBkb1ZhbGlkYXRlIGFscmVhZHkgY2FsbGVkIHRoZSBjYWxsYmFjayBvciB0aHJldyB0aGUgZXJyb3Igc28gd2UncmUgZG9uZS5cbiAgICAgICAgLy8gQnV0IGluc2VydCBzaG91bGQgYWx3YXlzIHJldHVybiBhbiBJRCB0byBtYXRjaCBjb3JlIGJlaGF2aW9yLlxuICAgICAgICByZXR1cm4gbWV0aG9kTmFtZSA9PT0gXCJpbnNlcnRcIiA/IHRoaXMuX21ha2VOZXdJRCgpIDogdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBXZSBzdGlsbCBuZWVkIHRvIGFkanVzdCBhcmdzIGJlY2F1c2UgaW5zZXJ0IGRvZXMgbm90IHRha2Ugb3B0aW9uc1xuICAgICAgaWYgKG1ldGhvZE5hbWUgPT09IFwiaW5zZXJ0XCIgJiYgdHlwZW9mIGFyZ3NbMV0gIT09ICdmdW5jdGlvbicpIGFyZ3Muc3BsaWNlKDEsIDEpO1xuICAgIH1cblxuICAgIHJldHVybiBfc3VwZXIuYXBwbHkodGhpcywgYXJncyk7XG4gIH07XG59KTtcblxuLypcbiAqIFByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBkb1ZhbGlkYXRlKGNvbGxlY3Rpb24sIHR5cGUsIGFyZ3MsIGdldEF1dG9WYWx1ZXMsIHVzZXJJZCwgaXNGcm9tVHJ1c3RlZENvZGUpIHtcbiAgdmFyIGRvYywgY2FsbGJhY2ssIGVycm9yLCBvcHRpb25zLCBpc1Vwc2VydCwgc2VsZWN0b3IsIGxhc3QsIGhhc0NhbGxiYWNrO1xuXG4gIGlmICghYXJncy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IodHlwZSArIFwiIHJlcXVpcmVzIGFuIGFyZ3VtZW50XCIpO1xuICB9XG5cbiAgLy8gR2F0aGVyIGFyZ3VtZW50cyBhbmQgY2FjaGUgdGhlIHNlbGVjdG9yXG4gIGlmICh0eXBlID09PSBcImluc2VydFwiKSB7XG4gICAgZG9jID0gYXJnc1swXTtcbiAgICBvcHRpb25zID0gYXJnc1sxXTtcbiAgICBjYWxsYmFjayA9IGFyZ3NbMl07XG5cbiAgICAvLyBUaGUgcmVhbCBpbnNlcnQgZG9lc24ndCB0YWtlIG9wdGlvbnNcbiAgICBpZiAodHlwZW9mIG9wdGlvbnMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXJncyA9IFtkb2MsIG9wdGlvbnNdO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGNhbGxiYWNrID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGFyZ3MgPSBbZG9jLCBjYWxsYmFja107XG4gICAgfSBlbHNlIHtcbiAgICAgIGFyZ3MgPSBbZG9jXTtcbiAgICB9XG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gXCJ1cGRhdGVcIikge1xuICAgIHNlbGVjdG9yID0gYXJnc1swXTtcbiAgICBkb2MgPSBhcmdzWzFdO1xuICAgIG9wdGlvbnMgPSBhcmdzWzJdO1xuICAgIGNhbGxiYWNrID0gYXJnc1szXTtcbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnZhbGlkIHR5cGUgYXJndW1lbnRcIik7XG4gIH1cblxuICB2YXIgdmFsaWRhdGVkT2JqZWN0V2FzSW5pdGlhbGx5RW1wdHkgPSBpc0VtcHR5KGRvYyk7XG5cbiAgLy8gU3VwcG9ydCBtaXNzaW5nIG9wdGlvbnMgYXJnXG4gIGlmICghY2FsbGJhY2sgJiYgdHlwZW9mIG9wdGlvbnMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIGNhbGxiYWNrID0gb3B0aW9ucztcbiAgICBvcHRpb25zID0ge307XG4gIH1cbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgbGFzdCA9IGFyZ3MubGVuZ3RoIC0gMTtcblxuICBoYXNDYWxsYmFjayA9ICh0eXBlb2YgYXJnc1tsYXN0XSA9PT0gJ2Z1bmN0aW9uJyk7XG5cbiAgLy8gSWYgdXBkYXRlIHdhcyBjYWxsZWQgd2l0aCB1cHNlcnQ6dHJ1ZSwgZmxhZyBhcyBhbiB1cHNlcnRcbiAgaXNVcHNlcnQgPSAodHlwZSA9PT0gXCJ1cGRhdGVcIiAmJiBvcHRpb25zLnVwc2VydCA9PT0gdHJ1ZSk7XG5cbiAgLy8gd2UgbmVlZCB0byBwYXNzIGBkb2NgIGFuZCBgb3B0aW9uc2AgdG8gYHNpbXBsZVNjaGVtYWAgbWV0aG9kLCB0aGF0J3Mgd2h5XG4gIC8vIHNjaGVtYSBkZWNsYXJhdGlvbiBtb3ZlZCBoZXJlXG4gIHZhciBzY2hlbWEgPSBjb2xsZWN0aW9uLnNpbXBsZVNjaGVtYShkb2MsIG9wdGlvbnMsIHNlbGVjdG9yKTtcbiAgdmFyIGlzTG9jYWxDb2xsZWN0aW9uID0gKGNvbGxlY3Rpb24uX2Nvbm5lY3Rpb24gPT09IG51bGwpO1xuXG4gIC8vIE9uIHRoZSBzZXJ2ZXIgYW5kIGZvciBsb2NhbCBjb2xsZWN0aW9ucywgd2UgYWxsb3cgcGFzc2luZyBgZ2V0QXV0b1ZhbHVlczogZmFsc2VgIHRvIGRpc2FibGUgYXV0b1ZhbHVlIGZ1bmN0aW9uc1xuICBpZiAoKE1ldGVvci5pc1NlcnZlciB8fCBpc0xvY2FsQ29sbGVjdGlvbikgJiYgb3B0aW9ucy5nZXRBdXRvVmFsdWVzID09PSBmYWxzZSkge1xuICAgIGdldEF1dG9WYWx1ZXMgPSBmYWxzZTtcbiAgfVxuXG4gIC8vIERldGVybWluZSB2YWxpZGF0aW9uIGNvbnRleHRcbiAgdmFyIHZhbGlkYXRpb25Db250ZXh0ID0gb3B0aW9ucy52YWxpZGF0aW9uQ29udGV4dDtcbiAgaWYgKHZhbGlkYXRpb25Db250ZXh0KSB7XG4gICAgaWYgKHR5cGVvZiB2YWxpZGF0aW9uQ29udGV4dCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHZhbGlkYXRpb25Db250ZXh0ID0gc2NoZW1hLm5hbWVkQ29udGV4dCh2YWxpZGF0aW9uQ29udGV4dCk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhbGlkYXRpb25Db250ZXh0ID0gc2NoZW1hLm5hbWVkQ29udGV4dCgpO1xuICB9XG5cbiAgLy8gQWRkIGEgZGVmYXVsdCBjYWxsYmFjayBmdW5jdGlvbiBpZiB3ZSdyZSBvbiB0aGUgY2xpZW50IGFuZCBubyBjYWxsYmFjayB3YXMgZ2l2ZW5cbiAgaWYgKE1ldGVvci5pc0NsaWVudCAmJiAhY2FsbGJhY2spIHtcbiAgICAvLyBDbGllbnQgY2FuJ3QgYmxvY2ssIHNvIGl0IGNhbid0IHJlcG9ydCBlcnJvcnMgYnkgZXhjZXB0aW9uLFxuICAgIC8vIG9ubHkgYnkgY2FsbGJhY2suIElmIHRoZXkgZm9yZ2V0IHRoZSBjYWxsYmFjaywgZ2l2ZSB0aGVtIGFcbiAgICAvLyBkZWZhdWx0IG9uZSB0aGF0IGxvZ3MgdGhlIGVycm9yLCBzbyB0aGV5IGFyZW4ndCB0b3RhbGx5XG4gICAgLy8gYmFmZmxlZCBpZiB0aGVpciB3cml0ZXMgZG9uJ3Qgd29yayBiZWNhdXNlIHRoZWlyIGRhdGFiYXNlIGlzXG4gICAgLy8gZG93bi5cbiAgICBjYWxsYmFjayA9IGZ1bmN0aW9uKGVycikge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICBNZXRlb3IuX2RlYnVnKHR5cGUgKyBcIiBmYWlsZWQ6IFwiICsgKGVyci5yZWFzb24gfHwgZXJyLnN0YWNrKSk7XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8vIElmIGNsaWVudCB2YWxpZGF0aW9uIGlzIGZpbmUgb3IgaXMgc2tpcHBlZCBidXQgdGhlbiBzb21ldGhpbmdcbiAgLy8gaXMgZm91bmQgdG8gYmUgaW52YWxpZCBvbiB0aGUgc2VydmVyLCB3ZSBnZXQgdGhhdCBlcnJvciBiYWNrXG4gIC8vIGFzIGEgc3BlY2lhbCBNZXRlb3IuRXJyb3IgdGhhdCB3ZSBuZWVkIHRvIHBhcnNlLlxuICBpZiAoTWV0ZW9yLmlzQ2xpZW50ICYmIGhhc0NhbGxiYWNrKSB7XG4gICAgY2FsbGJhY2sgPSBhcmdzW2xhc3RdID0gd3JhcENhbGxiYWNrRm9yUGFyc2luZ1NlcnZlckVycm9ycyh2YWxpZGF0aW9uQ29udGV4dCwgY2FsbGJhY2spO1xuICB9XG5cbiAgdmFyIHNjaGVtYUFsbG93c0lkID0gc2NoZW1hLmFsbG93c0tleShcIl9pZFwiKTtcbiAgaWYgKHR5cGUgPT09IFwiaW5zZXJ0XCIgJiYgIWRvYy5faWQgJiYgc2NoZW1hQWxsb3dzSWQpIHtcbiAgICBkb2MuX2lkID0gY29sbGVjdGlvbi5fbWFrZU5ld0lEKCk7XG4gIH1cblxuICAvLyBHZXQgdGhlIGRvY0lkIGZvciBwYXNzaW5nIGluIHRoZSBhdXRvVmFsdWUvY3VzdG9tIGNvbnRleHRcbiAgdmFyIGRvY0lkO1xuICBpZiAodHlwZSA9PT0gJ2luc2VydCcpIHtcbiAgICBkb2NJZCA9IGRvYy5faWQ7IC8vIG1pZ2h0IGJlIHVuZGVmaW5lZFxuICB9IGVsc2UgaWYgKHR5cGUgPT09IFwidXBkYXRlXCIgJiYgc2VsZWN0b3IpIHtcbiAgICBkb2NJZCA9IHR5cGVvZiBzZWxlY3RvciA9PT0gJ3N0cmluZycgfHwgc2VsZWN0b3IgaW5zdGFuY2VvZiBNb25nby5PYmplY3RJRCA/IHNlbGVjdG9yIDogc2VsZWN0b3IuX2lkO1xuICB9XG5cbiAgLy8gSWYgX2lkIGhhcyBhbHJlYWR5IGJlZW4gYWRkZWQsIHJlbW92ZSBpdCB0ZW1wb3JhcmlseSBpZiBpdCdzXG4gIC8vIG5vdCBleHBsaWNpdGx5IGRlZmluZWQgaW4gdGhlIHNjaGVtYS5cbiAgdmFyIGNhY2hlZElkO1xuICBpZiAoZG9jLl9pZCAmJiAhc2NoZW1hQWxsb3dzSWQpIHtcbiAgICBjYWNoZWRJZCA9IGRvYy5faWQ7XG4gICAgZGVsZXRlIGRvYy5faWQ7XG4gIH1cblxuICBjb25zdCBhdXRvVmFsdWVDb250ZXh0ID0ge1xuICAgIGlzSW5zZXJ0OiAodHlwZSA9PT0gXCJpbnNlcnRcIiksXG4gICAgaXNVcGRhdGU6ICh0eXBlID09PSBcInVwZGF0ZVwiICYmIG9wdGlvbnMudXBzZXJ0ICE9PSB0cnVlKSxcbiAgICBpc1Vwc2VydCxcbiAgICB1c2VySWQsXG4gICAgaXNGcm9tVHJ1c3RlZENvZGUsXG4gICAgZG9jSWQsXG4gICAgaXNMb2NhbENvbGxlY3Rpb25cbiAgfTtcblxuICBjb25zdCBleHRlbmRBdXRvVmFsdWVDb250ZXh0ID0ge1xuICAgIC4uLigoc2NoZW1hLl9jbGVhbk9wdGlvbnMgfHwge30pLmV4dGVuZEF1dG9WYWx1ZUNvbnRleHQgfHwge30pLFxuICAgIC4uLmF1dG9WYWx1ZUNvbnRleHQsXG4gICAgLi4ub3B0aW9ucy5leHRlbmRBdXRvVmFsdWVDb250ZXh0LFxuICB9O1xuXG4gIGNvbnN0IGNsZWFuT3B0aW9uc0ZvclRoaXNPcGVyYXRpb24gPSB7fTtcbiAgW1wiYXV0b0NvbnZlcnRcIiwgXCJmaWx0ZXJcIiwgXCJyZW1vdmVFbXB0eVN0cmluZ3NcIiwgXCJyZW1vdmVOdWxsc0Zyb21BcnJheXNcIiwgXCJ0cmltU3RyaW5nc1wiXS5mb3JFYWNoKHByb3AgPT4ge1xuICAgIGlmICh0eXBlb2Ygb3B0aW9uc1twcm9wXSA9PT0gXCJib29sZWFuXCIpIHtcbiAgICAgIGNsZWFuT3B0aW9uc0ZvclRoaXNPcGVyYXRpb25bcHJvcF0gPSBvcHRpb25zW3Byb3BdO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gUHJlbGltaW5hcnkgY2xlYW5pbmcgb24gYm90aCBjbGllbnQgYW5kIHNlcnZlci4gT24gdGhlIHNlcnZlciBhbmQgZm9yIGxvY2FsXG4gIC8vIGNvbGxlY3Rpb25zLCBhdXRvbWF0aWMgdmFsdWVzIHdpbGwgYWxzbyBiZSBzZXQgYXQgdGhpcyBwb2ludC5cbiAgc2NoZW1hLmNsZWFuKGRvYywge1xuICAgIG11dGF0ZTogdHJ1ZSwgLy8gQ2xlYW4gdGhlIGRvYy9tb2RpZmllciBpbiBwbGFjZVxuICAgIGlzTW9kaWZpZXI6ICh0eXBlICE9PSBcImluc2VydFwiKSxcbiAgICAvLyBTdGFydCB3aXRoIHNvbWUgQ29sbGVjdGlvbjIgZGVmYXVsdHMsIHdoaWNoIHdpbGwgdXN1YWxseSBiZSBvdmVyd3JpdHRlblxuICAgIC4uLmRlZmF1bHRDbGVhbk9wdGlvbnMsXG4gICAgLy8gVGhlIGV4dGVuZCB3aXRoIHRoZSBzY2hlbWEtbGV2ZWwgZGVmYXVsdHMgKGZyb20gU2ltcGxlU2NoZW1hIGNvbnN0cnVjdG9yIG9wdGlvbnMpXG4gICAgLi4uKHNjaGVtYS5fY2xlYW5PcHRpb25zIHx8IHt9KSxcbiAgICAvLyBGaW5hbGx5LCBvcHRpb25zIGZvciB0aGlzIHNwZWNpZmljIG9wZXJhdGlvbiBzaG91bGQgdGFrZSBwcmVjZWRhbmNlXG4gICAgLi4uY2xlYW5PcHRpb25zRm9yVGhpc09wZXJhdGlvbixcbiAgICBleHRlbmRBdXRvVmFsdWVDb250ZXh0LCAvLyBUaGlzIHdhcyBleHRlbmRlZCBzZXBhcmF0ZWx5IGFib3ZlXG4gICAgZ2V0QXV0b1ZhbHVlcywgLy8gRm9yY2UgdGhpcyBvdmVycmlkZVxuICB9KTtcblxuICAvLyBXZSBjbG9uZSBiZWZvcmUgdmFsaWRhdGluZyBiZWNhdXNlIGluIHNvbWUgY2FzZXMgd2UgbmVlZCB0byBhZGp1c3QgdGhlXG4gIC8vIG9iamVjdCBhIGJpdCBiZWZvcmUgdmFsaWRhdGluZyBpdC4gSWYgd2UgYWRqdXN0ZWQgYGRvY2AgaXRzZWxmLCBvdXJcbiAgLy8gY2hhbmdlcyB3b3VsZCBwZXJzaXN0IGludG8gdGhlIGRhdGFiYXNlLlxuICB2YXIgZG9jVG9WYWxpZGF0ZSA9IHt9O1xuICBmb3IgKHZhciBwcm9wIGluIGRvYykge1xuICAgIC8vIFdlIG9taXQgcHJvdG90eXBlIHByb3BlcnRpZXMgd2hlbiBjbG9uaW5nIGJlY2F1c2UgdGhleSB3aWxsIG5vdCBiZSB2YWxpZFxuICAgIC8vIGFuZCBtb25nbyBvbWl0cyB0aGVtIHdoZW4gc2F2aW5nIHRvIHRoZSBkYXRhYmFzZSBhbnl3YXkuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChkb2MsIHByb3ApKSB7XG4gICAgICBkb2NUb1ZhbGlkYXRlW3Byb3BdID0gZG9jW3Byb3BdO1xuICAgIH1cbiAgfVxuXG4gIC8vIE9uIHRoZSBzZXJ2ZXIsIHVwc2VydHMgYXJlIHBvc3NpYmxlOyBTaW1wbGVTY2hlbWEgaGFuZGxlcyB1cHNlcnRzIHByZXR0eVxuICAvLyB3ZWxsIGJ5IGRlZmF1bHQsIGJ1dCBpdCB3aWxsIG5vdCBrbm93IGFib3V0IHRoZSBmaWVsZHMgaW4gdGhlIHNlbGVjdG9yLFxuICAvLyB3aGljaCBhcmUgYWxzbyBzdG9yZWQgaW4gdGhlIGRhdGFiYXNlIGlmIGFuIGluc2VydCBpcyBwZXJmb3JtZWQuIFNvIHdlXG4gIC8vIHdpbGwgYWxsb3cgdGhlc2UgZmllbGRzIHRvIGJlIGNvbnNpZGVyZWQgZm9yIHZhbGlkYXRpb24gYnkgYWRkaW5nIHRoZW1cbiAgLy8gdG8gdGhlICRzZXQgaW4gdGhlIG1vZGlmaWVyLiBUaGlzIGlzIG5vIGRvdWJ0IHByb25lIHRvIGVycm9ycywgYnV0IHRoZXJlXG4gIC8vIHByb2JhYmx5IGlzbid0IGFueSBiZXR0ZXIgd2F5IHJpZ2h0IG5vdy5cbiAgaWYgKE1ldGVvci5pc1NlcnZlciAmJiBpc1Vwc2VydCAmJiBpc09iamVjdChzZWxlY3RvcikpIHtcbiAgICB2YXIgc2V0ID0gZG9jVG9WYWxpZGF0ZS4kc2V0IHx8IHt9O1xuXG4gICAgLy8gSWYgc2VsZWN0b3IgdXNlcyAkYW5kIGZvcm1hdCwgY29udmVydCB0byBwbGFpbiBvYmplY3Qgc2VsZWN0b3JcbiAgICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3Rvci4kYW5kKSkge1xuICAgICAgY29uc3QgcGxhaW5TZWxlY3RvciA9IHt9O1xuICAgICAgc2VsZWN0b3IuJGFuZC5mb3JFYWNoKHNlbCA9PiB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24ocGxhaW5TZWxlY3Rvciwgc2VsKTtcbiAgICAgIH0pO1xuICAgICAgZG9jVG9WYWxpZGF0ZS4kc2V0ID0gcGxhaW5TZWxlY3RvcjtcbiAgICB9IGVsc2Uge1xuICAgICAgZG9jVG9WYWxpZGF0ZS4kc2V0ID0gY2xvbmUoc2VsZWN0b3IpO1xuICAgIH1cblxuICAgIGlmICghc2NoZW1hQWxsb3dzSWQpIGRlbGV0ZSBkb2NUb1ZhbGlkYXRlLiRzZXQuX2lkO1xuICAgIE9iamVjdC5hc3NpZ24oZG9jVG9WYWxpZGF0ZS4kc2V0LCBzZXQpO1xuICB9XG5cbiAgLy8gU2V0IGF1dG9tYXRpYyB2YWx1ZXMgZm9yIHZhbGlkYXRpb24gb24gdGhlIGNsaWVudC5cbiAgLy8gT24gdGhlIHNlcnZlciwgd2UgYWxyZWFkeSB1cGRhdGVkIGRvYyB3aXRoIGF1dG8gdmFsdWVzLCBidXQgb24gdGhlIGNsaWVudCxcbiAgLy8gd2Ugd2lsbCBhZGQgdGhlbSB0byBkb2NUb1ZhbGlkYXRlIGZvciB2YWxpZGF0aW9uIHB1cnBvc2VzIG9ubHkuXG4gIC8vIFRoaXMgaXMgYmVjYXVzZSB3ZSB3YW50IGFsbCBhY3R1YWwgdmFsdWVzIGdlbmVyYXRlZCBvbiB0aGUgc2VydmVyLlxuICBpZiAoTWV0ZW9yLmlzQ2xpZW50ICYmICFpc0xvY2FsQ29sbGVjdGlvbikge1xuICAgIHNjaGVtYS5jbGVhbihkb2NUb1ZhbGlkYXRlLCB7XG4gICAgICBhdXRvQ29udmVydDogZmFsc2UsXG4gICAgICBleHRlbmRBdXRvVmFsdWVDb250ZXh0LFxuICAgICAgZmlsdGVyOiBmYWxzZSxcbiAgICAgIGdldEF1dG9WYWx1ZXM6IHRydWUsXG4gICAgICBpc01vZGlmaWVyOiAodHlwZSAhPT0gXCJpbnNlcnRcIiksXG4gICAgICBtdXRhdGU6IHRydWUsIC8vIENsZWFuIHRoZSBkb2MvbW9kaWZpZXIgaW4gcGxhY2VcbiAgICAgIHJlbW92ZUVtcHR5U3RyaW5nczogZmFsc2UsXG4gICAgICByZW1vdmVOdWxsc0Zyb21BcnJheXM6IGZhbHNlLFxuICAgICAgdHJpbVN0cmluZ3M6IGZhbHNlLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gWFhYIE1heWJlIG1vdmUgdGhpcyBpbnRvIFNpbXBsZVNjaGVtYVxuICBpZiAoIXZhbGlkYXRlZE9iamVjdFdhc0luaXRpYWxseUVtcHR5ICYmIGlzRW1wdHkoZG9jVG9WYWxpZGF0ZSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0FmdGVyIGZpbHRlcmluZyBvdXQga2V5cyBub3QgaW4gdGhlIHNjaGVtYSwgeW91ciAnICtcbiAgICAgICh0eXBlID09PSAndXBkYXRlJyA/ICdtb2RpZmllcicgOiAnb2JqZWN0JykgK1xuICAgICAgJyBpcyBub3cgZW1wdHknKTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIGRvY1xuICB2YXIgaXNWYWxpZDtcbiAgaWYgKG9wdGlvbnMudmFsaWRhdGUgPT09IGZhbHNlKSB7XG4gICAgaXNWYWxpZCA9IHRydWU7XG4gIH0gZWxzZSB7XG4gICAgaXNWYWxpZCA9IHZhbGlkYXRpb25Db250ZXh0LnZhbGlkYXRlKGRvY1RvVmFsaWRhdGUsIHtcbiAgICAgIG1vZGlmaWVyOiAodHlwZSA9PT0gXCJ1cGRhdGVcIiB8fCB0eXBlID09PSBcInVwc2VydFwiKSxcbiAgICAgIHVwc2VydDogaXNVcHNlcnQsXG4gICAgICBleHRlbmRlZEN1c3RvbUNvbnRleHQ6IHtcbiAgICAgICAgaXNJbnNlcnQ6ICh0eXBlID09PSBcImluc2VydFwiKSxcbiAgICAgICAgaXNVcGRhdGU6ICh0eXBlID09PSBcInVwZGF0ZVwiICYmIG9wdGlvbnMudXBzZXJ0ICE9PSB0cnVlKSxcbiAgICAgICAgaXNVcHNlcnQsXG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgaXNGcm9tVHJ1c3RlZENvZGUsXG4gICAgICAgIGRvY0lkLFxuICAgICAgICBpc0xvY2FsQ29sbGVjdGlvbixcbiAgICAgICAgLi4uKG9wdGlvbnMuZXh0ZW5kZWRDdXN0b21Db250ZXh0IHx8IHt9KSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICBpZiAoaXNWYWxpZCkge1xuICAgIC8vIEFkZCB0aGUgSUQgYmFja1xuICAgIGlmIChjYWNoZWRJZCkge1xuICAgICAgZG9jLl9pZCA9IGNhY2hlZElkO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZSB0aGUgYXJncyB0byByZWZsZWN0IHRoZSBjbGVhbmVkIGRvY1xuICAgIC8vIFhYWCBub3Qgc3VyZSB0aGlzIGlzIG5lY2Vzc2FyeSBzaW5jZSB3ZSBtdXRhdGVcbiAgICBpZiAodHlwZSA9PT0gXCJpbnNlcnRcIikge1xuICAgICAgYXJnc1swXSA9IGRvYztcbiAgICB9IGVsc2Uge1xuICAgICAgYXJnc1sxXSA9IGRvYztcbiAgICB9XG5cbiAgICAvLyBJZiBjYWxsYmFjaywgc2V0IGludmFsaWRLZXkgd2hlbiB3ZSBnZXQgYSBtb25nbyB1bmlxdWUgZXJyb3JcbiAgICBpZiAoTWV0ZW9yLmlzU2VydmVyICYmIGhhc0NhbGxiYWNrKSB7XG4gICAgICBhcmdzW2xhc3RdID0gd3JhcENhbGxiYWNrRm9yUGFyc2luZ01vbmdvVmFsaWRhdGlvbkVycm9ycyh2YWxpZGF0aW9uQ29udGV4dCwgYXJnc1tsYXN0XSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFyZ3M7XG4gIH0gZWxzZSB7XG4gICAgZXJyb3IgPSBnZXRFcnJvck9iamVjdCh2YWxpZGF0aW9uQ29udGV4dCwgYGluICR7Y29sbGVjdGlvbi5fbmFtZX0gJHt0eXBlfWApO1xuICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgLy8gaW5zZXJ0L3VwZGF0ZS91cHNlcnQgcGFzcyBgZmFsc2VgIHdoZW4gdGhlcmUncyBhbiBlcnJvciwgc28gd2UgZG8gdGhhdFxuICAgICAgY2FsbGJhY2soZXJyb3IsIGZhbHNlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGdldEVycm9yT2JqZWN0KGNvbnRleHQsIGFwcGVuZFRvTWVzc2FnZSA9ICcnKSB7XG4gIGxldCBtZXNzYWdlO1xuICBjb25zdCBpbnZhbGlkS2V5cyA9ICh0eXBlb2YgY29udGV4dC52YWxpZGF0aW9uRXJyb3JzID09PSAnZnVuY3Rpb24nKSA/IGNvbnRleHQudmFsaWRhdGlvbkVycm9ycygpIDogY29udGV4dC5pbnZhbGlkS2V5cygpO1xuICBpZiAoaW52YWxpZEtleXMubGVuZ3RoKSB7XG4gICAgY29uc3QgZmlyc3RFcnJvcktleSA9IGludmFsaWRLZXlzWzBdLm5hbWU7XG4gICAgY29uc3QgZmlyc3RFcnJvck1lc3NhZ2UgPSBjb250ZXh0LmtleUVycm9yTWVzc2FnZShmaXJzdEVycm9yS2V5KTtcblxuICAgIC8vIElmIHRoZSBlcnJvciBpcyBpbiBhIG5lc3RlZCBrZXksIGFkZCB0aGUgZnVsbCBrZXkgdG8gdGhlIGVycm9yIG1lc3NhZ2VcbiAgICAvLyB0byBiZSBtb3JlIGhlbHBmdWwuXG4gICAgaWYgKGZpcnN0RXJyb3JLZXkuaW5kZXhPZignLicpID09PSAtMSkge1xuICAgICAgbWVzc2FnZSA9IGZpcnN0RXJyb3JNZXNzYWdlO1xuICAgIH0gZWxzZSB7XG4gICAgICBtZXNzYWdlID0gYCR7Zmlyc3RFcnJvck1lc3NhZ2V9ICgke2ZpcnN0RXJyb3JLZXl9KWA7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIG1lc3NhZ2UgPSBcIkZhaWxlZCB2YWxpZGF0aW9uXCI7XG4gIH1cbiAgbWVzc2FnZSA9IGAke21lc3NhZ2V9ICR7YXBwZW5kVG9NZXNzYWdlfWAudHJpbSgpO1xuICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihtZXNzYWdlKTtcbiAgZXJyb3IuaW52YWxpZEtleXMgPSBpbnZhbGlkS2V5cztcbiAgZXJyb3IudmFsaWRhdGlvbkNvbnRleHQgPSBjb250ZXh0O1xuICAvLyBJZiBvbiB0aGUgc2VydmVyLCB3ZSBhZGQgYSBzYW5pdGl6ZWQgZXJyb3IsIHRvbywgaW4gY2FzZSB3ZSdyZVxuICAvLyBjYWxsZWQgZnJvbSBhIG1ldGhvZC5cbiAgaWYgKE1ldGVvci5pc1NlcnZlcikge1xuICAgIGVycm9yLnNhbml0aXplZEVycm9yID0gbmV3IE1ldGVvci5FcnJvcig0MDAsIG1lc3NhZ2UsIEVKU09OLnN0cmluZ2lmeShlcnJvci5pbnZhbGlkS2V5cykpO1xuICB9XG4gIHJldHVybiBlcnJvcjtcbn1cblxuZnVuY3Rpb24gYWRkVW5pcXVlRXJyb3IoY29udGV4dCwgZXJyb3JNZXNzYWdlKSB7XG4gIHZhciBuYW1lID0gZXJyb3JNZXNzYWdlLnNwbGl0KCdjMl8nKVsxXS5zcGxpdCgnICcpWzBdO1xuICB2YXIgdmFsID0gZXJyb3JNZXNzYWdlLnNwbGl0KCdkdXAga2V5OicpWzFdLnNwbGl0KCdcIicpWzFdO1xuXG4gIHZhciBhZGRWYWxpZGF0aW9uRXJyb3JzUHJvcE5hbWUgPSAodHlwZW9mIGNvbnRleHQuYWRkVmFsaWRhdGlvbkVycm9ycyA9PT0gJ2Z1bmN0aW9uJykgPyAnYWRkVmFsaWRhdGlvbkVycm9ycycgOiAnYWRkSW52YWxpZEtleXMnO1xuICBjb250ZXh0W2FkZFZhbGlkYXRpb25FcnJvcnNQcm9wTmFtZV0oW3tcbiAgICBuYW1lOiBuYW1lLFxuICAgIHR5cGU6ICdub3RVbmlxdWUnLFxuICAgIHZhbHVlOiB2YWxcbiAgfV0pO1xufVxuXG5mdW5jdGlvbiB3cmFwQ2FsbGJhY2tGb3JQYXJzaW5nTW9uZ29WYWxpZGF0aW9uRXJyb3JzKHZhbGlkYXRpb25Db250ZXh0LCBjYikge1xuICByZXR1cm4gZnVuY3Rpb24gd3JhcHBlZENhbGxiYWNrRm9yUGFyc2luZ01vbmdvVmFsaWRhdGlvbkVycm9ycyguLi5hcmdzKSB7XG4gICAgY29uc3QgZXJyb3IgPSBhcmdzWzBdO1xuICAgIGlmIChlcnJvciAmJlxuICAgICAgICAoKGVycm9yLm5hbWUgPT09IFwiTW9uZ29FcnJvclwiICYmIGVycm9yLmNvZGUgPT09IDExMDAxKSB8fCBlcnJvci5tZXNzYWdlLmluZGV4T2YoJ01vbmdvRXJyb3I6IEUxMTAwMCcgIT09IC0xKSkgJiZcbiAgICAgICAgZXJyb3IubWVzc2FnZS5pbmRleE9mKCdjMl8nKSAhPT0gLTEpIHtcbiAgICAgIGFkZFVuaXF1ZUVycm9yKHZhbGlkYXRpb25Db250ZXh0LCBlcnJvci5tZXNzYWdlKTtcbiAgICAgIGFyZ3NbMF0gPSBnZXRFcnJvck9iamVjdCh2YWxpZGF0aW9uQ29udGV4dCk7XG4gICAgfVxuICAgIHJldHVybiBjYi5hcHBseSh0aGlzLCBhcmdzKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gd3JhcENhbGxiYWNrRm9yUGFyc2luZ1NlcnZlckVycm9ycyh2YWxpZGF0aW9uQ29udGV4dCwgY2IpIHtcbiAgdmFyIGFkZFZhbGlkYXRpb25FcnJvcnNQcm9wTmFtZSA9ICh0eXBlb2YgdmFsaWRhdGlvbkNvbnRleHQuYWRkVmFsaWRhdGlvbkVycm9ycyA9PT0gJ2Z1bmN0aW9uJykgPyAnYWRkVmFsaWRhdGlvbkVycm9ycycgOiAnYWRkSW52YWxpZEtleXMnO1xuICByZXR1cm4gZnVuY3Rpb24gd3JhcHBlZENhbGxiYWNrRm9yUGFyc2luZ1NlcnZlckVycm9ycyguLi5hcmdzKSB7XG4gICAgY29uc3QgZXJyb3IgPSBhcmdzWzBdO1xuICAgIC8vIEhhbmRsZSBvdXIgb3duIHZhbGlkYXRpb24gZXJyb3JzXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgTWV0ZW9yLkVycm9yICYmXG4gICAgICAgIGVycm9yLmVycm9yID09PSA0MDAgJiZcbiAgICAgICAgZXJyb3IucmVhc29uID09PSBcIklOVkFMSURcIiAmJlxuICAgICAgICB0eXBlb2YgZXJyb3IuZGV0YWlscyA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgdmFyIGludmFsaWRLZXlzRnJvbVNlcnZlciA9IEVKU09OLnBhcnNlKGVycm9yLmRldGFpbHMpO1xuICAgICAgdmFsaWRhdGlvbkNvbnRleHRbYWRkVmFsaWRhdGlvbkVycm9yc1Byb3BOYW1lXShpbnZhbGlkS2V5c0Zyb21TZXJ2ZXIpO1xuICAgICAgYXJnc1swXSA9IGdldEVycm9yT2JqZWN0KHZhbGlkYXRpb25Db250ZXh0KTtcbiAgICB9XG4gICAgLy8gSGFuZGxlIE1vbmdvIHVuaXF1ZSBpbmRleCBlcnJvcnMsIHdoaWNoIGFyZSBmb3J3YXJkZWQgdG8gdGhlIGNsaWVudCBhcyA0MDkgZXJyb3JzXG4gICAgZWxzZSBpZiAoZXJyb3IgaW5zdGFuY2VvZiBNZXRlb3IuRXJyb3IgJiZcbiAgICAgICAgICAgICBlcnJvci5lcnJvciA9PT0gNDA5ICYmXG4gICAgICAgICAgICAgZXJyb3IucmVhc29uICYmXG4gICAgICAgICAgICAgZXJyb3IucmVhc29uLmluZGV4T2YoJ0UxMTAwMCcpICE9PSAtMSAmJlxuICAgICAgICAgICAgIGVycm9yLnJlYXNvbi5pbmRleE9mKCdjMl8nKSAhPT0gLTEpIHtcbiAgICAgIGFkZFVuaXF1ZUVycm9yKHZhbGlkYXRpb25Db250ZXh0LCBlcnJvci5yZWFzb24pO1xuICAgICAgYXJnc1swXSA9IGdldEVycm9yT2JqZWN0KHZhbGlkYXRpb25Db250ZXh0KTtcbiAgICB9XG4gICAgcmV0dXJuIGNiLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICB9O1xufVxuXG52YXIgYWxyZWFkeUluc2VjdXJlZCA9IHt9O1xuZnVuY3Rpb24ga2VlcEluc2VjdXJlKGMpIHtcbiAgLy8gSWYgaW5zZWN1cmUgcGFja2FnZSBpcyBpbiB1c2UsIHdlIG5lZWQgdG8gYWRkIGFsbG93IHJ1bGVzIHRoYXQgcmV0dXJuXG4gIC8vIHRydWUuIE90aGVyd2lzZSwgaXQgd291bGQgc2VlbWluZ2x5IHR1cm4gb2ZmIGluc2VjdXJlIG1vZGUuXG4gIGlmIChQYWNrYWdlICYmIFBhY2thZ2UuaW5zZWN1cmUgJiYgIWFscmVhZHlJbnNlY3VyZWRbYy5fbmFtZV0pIHtcbiAgICBjLmFsbG93KHtcbiAgICAgIGluc2VydDogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICAgIHVwZGF0ZTogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICAgIHJlbW92ZTogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgICBmZXRjaDogW10sXG4gICAgICB0cmFuc2Zvcm06IG51bGxcbiAgICB9KTtcbiAgICBhbHJlYWR5SW5zZWN1cmVkW2MuX25hbWVdID0gdHJ1ZTtcbiAgfVxuICAvLyBJZiBpbnNlY3VyZSBwYWNrYWdlIGlzIE5PVCBpbiB1c2UsIHRoZW4gYWRkaW5nIHRoZSB0d28gZGVueSBmdW5jdGlvbnNcbiAgLy8gZG9lcyBub3QgaGF2ZSBhbnkgZWZmZWN0IG9uIHRoZSBtYWluIGFwcCdzIHNlY3VyaXR5IHBhcmFkaWdtLiBUaGVcbiAgLy8gdXNlciB3aWxsIHN0aWxsIGJlIHJlcXVpcmVkIHRvIGFkZCBhdCBsZWFzdCBvbmUgYWxsb3cgZnVuY3Rpb24gb2YgaGVyXG4gIC8vIG93biBmb3IgZWFjaCBvcGVyYXRpb24gZm9yIHRoaXMgY29sbGVjdGlvbi4gQW5kIHRoZSB1c2VyIG1heSBzdGlsbCBhZGRcbiAgLy8gYWRkaXRpb25hbCBkZW55IGZ1bmN0aW9ucywgYnV0IGRvZXMgbm90IGhhdmUgdG8uXG59XG5cbnZhciBhbHJlYWR5RGVmaW5lZCA9IHt9O1xuZnVuY3Rpb24gZGVmaW5lRGVueShjLCBvcHRpb25zKSB7XG4gIGlmICghYWxyZWFkeURlZmluZWRbYy5fbmFtZV0pIHtcblxuICAgIHZhciBpc0xvY2FsQ29sbGVjdGlvbiA9IChjLl9jb25uZWN0aW9uID09PSBudWxsKTtcblxuICAgIC8vIEZpcnN0IGRlZmluZSBkZW55IGZ1bmN0aW9ucyB0byBleHRlbmQgZG9jIHdpdGggdGhlIHJlc3VsdHMgb2YgY2xlYW5cbiAgICAvLyBhbmQgYXV0b3ZhbHVlcy4gVGhpcyBtdXN0IGJlIGRvbmUgd2l0aCBcInRyYW5zZm9ybTogbnVsbFwiIG9yIHdlIHdvdWxkIGJlXG4gICAgLy8gZXh0ZW5kaW5nIGEgY2xvbmUgb2YgZG9jIGFuZCB0aGVyZWZvcmUgaGF2ZSBubyBlZmZlY3QuXG4gICAgYy5kZW55KHtcbiAgICAgIGluc2VydDogZnVuY3Rpb24odXNlcklkLCBkb2MpIHtcbiAgICAgICAgLy8gUmVmZXJlbmNlZCBkb2MgaXMgY2xlYW5lZCBpbiBwbGFjZVxuICAgICAgICBjLnNpbXBsZVNjaGVtYShkb2MpLmNsZWFuKGRvYywge1xuICAgICAgICAgIG11dGF0ZTogdHJ1ZSxcbiAgICAgICAgICBpc01vZGlmaWVyOiBmYWxzZSxcbiAgICAgICAgICAvLyBXZSBkb24ndCBkbyB0aGVzZSBoZXJlIGJlY2F1c2UgdGhleSBhcmUgZG9uZSBvbiB0aGUgY2xpZW50IGlmIGRlc2lyZWRcbiAgICAgICAgICBmaWx0ZXI6IGZhbHNlLFxuICAgICAgICAgIGF1dG9Db252ZXJ0OiBmYWxzZSxcbiAgICAgICAgICByZW1vdmVFbXB0eVN0cmluZ3M6IGZhbHNlLFxuICAgICAgICAgIHRyaW1TdHJpbmdzOiBmYWxzZSxcbiAgICAgICAgICBleHRlbmRBdXRvVmFsdWVDb250ZXh0OiB7XG4gICAgICAgICAgICBpc0luc2VydDogdHJ1ZSxcbiAgICAgICAgICAgIGlzVXBkYXRlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzVXBzZXJ0OiBmYWxzZSxcbiAgICAgICAgICAgIHVzZXJJZDogdXNlcklkLFxuICAgICAgICAgICAgaXNGcm9tVHJ1c3RlZENvZGU6IGZhbHNlLFxuICAgICAgICAgICAgZG9jSWQ6IGRvYy5faWQsXG4gICAgICAgICAgICBpc0xvY2FsQ29sbGVjdGlvbjogaXNMb2NhbENvbGxlY3Rpb25cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0sXG4gICAgICB1cGRhdGU6IGZ1bmN0aW9uKHVzZXJJZCwgZG9jLCBmaWVsZHMsIG1vZGlmaWVyKSB7XG4gICAgICAgIC8vIFJlZmVyZW5jZWQgbW9kaWZpZXIgaXMgY2xlYW5lZCBpbiBwbGFjZVxuICAgICAgICBjLnNpbXBsZVNjaGVtYShtb2RpZmllcikuY2xlYW4obW9kaWZpZXIsIHtcbiAgICAgICAgICBtdXRhdGU6IHRydWUsXG4gICAgICAgICAgaXNNb2RpZmllcjogdHJ1ZSxcbiAgICAgICAgICAvLyBXZSBkb24ndCBkbyB0aGVzZSBoZXJlIGJlY2F1c2UgdGhleSBhcmUgZG9uZSBvbiB0aGUgY2xpZW50IGlmIGRlc2lyZWRcbiAgICAgICAgICBmaWx0ZXI6IGZhbHNlLFxuICAgICAgICAgIGF1dG9Db252ZXJ0OiBmYWxzZSxcbiAgICAgICAgICByZW1vdmVFbXB0eVN0cmluZ3M6IGZhbHNlLFxuICAgICAgICAgIHRyaW1TdHJpbmdzOiBmYWxzZSxcbiAgICAgICAgICBleHRlbmRBdXRvVmFsdWVDb250ZXh0OiB7XG4gICAgICAgICAgICBpc0luc2VydDogZmFsc2UsXG4gICAgICAgICAgICBpc1VwZGF0ZTogdHJ1ZSxcbiAgICAgICAgICAgIGlzVXBzZXJ0OiBmYWxzZSxcbiAgICAgICAgICAgIHVzZXJJZDogdXNlcklkLFxuICAgICAgICAgICAgaXNGcm9tVHJ1c3RlZENvZGU6IGZhbHNlLFxuICAgICAgICAgICAgZG9jSWQ6IGRvYyAmJiBkb2MuX2lkLFxuICAgICAgICAgICAgaXNMb2NhbENvbGxlY3Rpb246IGlzTG9jYWxDb2xsZWN0aW9uXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9LFxuICAgICAgZmV0Y2g6IFsnX2lkJ10sXG4gICAgICB0cmFuc2Zvcm06IG51bGxcbiAgICB9KTtcblxuICAgIC8vIFNlY29uZCBkZWZpbmUgZGVueSBmdW5jdGlvbnMgdG8gdmFsaWRhdGUgYWdhaW4gb24gdGhlIHNlcnZlclxuICAgIC8vIGZvciBjbGllbnQtaW5pdGlhdGVkIGluc2VydHMgYW5kIHVwZGF0ZXMuIFRoZXNlIHNob3VsZCBiZVxuICAgIC8vIGNhbGxlZCBhZnRlciB0aGUgY2xlYW4vYXV0b3ZhbHVlIGZ1bmN0aW9ucyBzaW5jZSB3ZSdyZSBhZGRpbmdcbiAgICAvLyB0aGVtIGFmdGVyLiBUaGVzZSBtdXN0ICpub3QqIGhhdmUgXCJ0cmFuc2Zvcm06IG51bGxcIiBpZiBvcHRpb25zLnRyYW5zZm9ybSBpcyB0cnVlIGJlY2F1c2VcbiAgICAvLyB3ZSBuZWVkIHRvIHBhc3MgdGhlIGRvYyB0aHJvdWdoIGFueSB0cmFuc2Zvcm1zIHRvIGJlIHN1cmVcbiAgICAvLyB0aGF0IGN1c3RvbSB0eXBlcyBhcmUgcHJvcGVybHkgcmVjb2duaXplZCBmb3IgdHlwZSB2YWxpZGF0aW9uLlxuICAgIGMuZGVueSh7XG4gICAgICBpbnNlcnQ6IGZ1bmN0aW9uKHVzZXJJZCwgZG9jKSB7XG4gICAgICAgIC8vIFdlIHBhc3MgdGhlIGZhbHNlIG9wdGlvbnMgYmVjYXVzZSB3ZSB3aWxsIGhhdmUgZG9uZSB0aGVtIG9uIGNsaWVudCBpZiBkZXNpcmVkXG4gICAgICAgIGRvVmFsaWRhdGUoXG4gICAgICAgICAgYyxcbiAgICAgICAgICBcImluc2VydFwiLFxuICAgICAgICAgIFtcbiAgICAgICAgICAgIGRvYyxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdHJpbVN0cmluZ3M6IGZhbHNlLFxuICAgICAgICAgICAgICByZW1vdmVFbXB0eVN0cmluZ3M6IGZhbHNlLFxuICAgICAgICAgICAgICBmaWx0ZXI6IGZhbHNlLFxuICAgICAgICAgICAgICBhdXRvQ29udmVydDogZmFsc2VcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgTWV0ZW9yLkVycm9yKDQwMCwgJ0lOVkFMSUQnLCBFSlNPTi5zdHJpbmdpZnkoZXJyb3IuaW52YWxpZEtleXMpKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIF0sXG4gICAgICAgICAgZmFsc2UsIC8vIGdldEF1dG9WYWx1ZXNcbiAgICAgICAgICB1c2VySWQsXG4gICAgICAgICAgZmFsc2UgLy8gaXNGcm9tVHJ1c3RlZENvZGVcbiAgICAgICAgKTtcblxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9LFxuICAgICAgdXBkYXRlOiBmdW5jdGlvbih1c2VySWQsIGRvYywgZmllbGRzLCBtb2RpZmllcikge1xuICAgICAgICAvLyBOT1RFOiBUaGlzIHdpbGwgbmV2ZXIgYmUgYW4gdXBzZXJ0IGJlY2F1c2UgY2xpZW50LXNpZGUgdXBzZXJ0c1xuICAgICAgICAvLyBhcmUgbm90IGFsbG93ZWQgb25jZSB5b3UgZGVmaW5lIGFsbG93L2RlbnkgZnVuY3Rpb25zLlxuICAgICAgICAvLyBXZSBwYXNzIHRoZSBmYWxzZSBvcHRpb25zIGJlY2F1c2Ugd2Ugd2lsbCBoYXZlIGRvbmUgdGhlbSBvbiBjbGllbnQgaWYgZGVzaXJlZFxuICAgICAgICBkb1ZhbGlkYXRlKFxuICAgICAgICAgIGMsXG4gICAgICAgICAgXCJ1cGRhdGVcIixcbiAgICAgICAgICBbXG4gICAgICAgICAgICB7X2lkOiBkb2MgJiYgZG9jLl9pZH0sXG4gICAgICAgICAgICBtb2RpZmllcixcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdHJpbVN0cmluZ3M6IGZhbHNlLFxuICAgICAgICAgICAgICByZW1vdmVFbXB0eVN0cmluZ3M6IGZhbHNlLFxuICAgICAgICAgICAgICBmaWx0ZXI6IGZhbHNlLFxuICAgICAgICAgICAgICBhdXRvQ29udmVydDogZmFsc2VcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgTWV0ZW9yLkVycm9yKDQwMCwgJ0lOVkFMSUQnLCBFSlNPTi5zdHJpbmdpZnkoZXJyb3IuaW52YWxpZEtleXMpKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIF0sXG4gICAgICAgICAgZmFsc2UsIC8vIGdldEF1dG9WYWx1ZXNcbiAgICAgICAgICB1c2VySWQsXG4gICAgICAgICAgZmFsc2UgLy8gaXNGcm9tVHJ1c3RlZENvZGVcbiAgICAgICAgKTtcblxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9LFxuICAgICAgZmV0Y2g6IFsnX2lkJ10sXG4gICAgICAuLi4ob3B0aW9ucy50cmFuc2Zvcm0gPT09IHRydWUgPyB7fSA6IHt0cmFuc2Zvcm06IG51bGx9KSxcbiAgICB9KTtcblxuICAgIC8vIG5vdGUgdGhhdCB3ZSd2ZSBhbHJlYWR5IGRvbmUgdGhpcyBjb2xsZWN0aW9uIHNvIHRoYXQgd2UgZG9uJ3QgZG8gaXQgYWdhaW5cbiAgICAvLyBpZiBhdHRhY2hTY2hlbWEgaXMgY2FsbGVkIGFnYWluXG4gICAgYWxyZWFkeURlZmluZWRbYy5fbmFtZV0gPSB0cnVlO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IENvbGxlY3Rpb24yO1xuIl19
