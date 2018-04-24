(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var MongoInternals = Package.mongo.MongoInternals;
var Mongo = Package.mongo.Mongo;
var _ = Package.underscore._;
var LocalCollection = Package.minimongo.LocalCollection;
var Minimongo = Package.minimongo.Minimongo;
var Random = Package.random.Random;
var EJSON = Package.ejson.EJSON;
var ECMAScript = Package.ecmascript.ECMAScript;
var MongoID = Package['mongo-id'].MongoID;
var meteorInstall = Package.modules.meteorInstall;
var meteorBabelHelpers = Package['babel-runtime'].meteorBabelHelpers;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var rulesByCollection, addFuncForAll, ensureCreated, ensureDefaultAllow, getRulesForCollectionAndType, getCollectionName, Security, types, collections, arg, fieldNames;

var require = meteorInstall({"node_modules":{"meteor":{"ongoworks:security":{"lib":{"server":{"utility.js":function(){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// packages/ongoworks_security/lib/server/utility.js                                                                 //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
/* global _, rulesByCollection:true, addFuncForAll:true, ensureCreated:true, ensureDefaultAllow:true */
rulesByCollection = {};
var created = {
  allow: {
    insert: {},
    update: {},
    remove: {},
    download: {} // for use with CollectionFS packages

  },
  deny: {
    insert: {},
    update: {},
    remove: {},
    download: {} // for use with CollectionFS packages

  }
};
/**
 * Adds the given function as an allow or deny function for all specified collections and types.
 * @param {Array(Mongo.Collection)} collections Array of Mongo.Collection instances
 * @param {String}                  allowOrDeny "allow" or "deny"
 * @param {Array(String)}           types       Array of types ("insert", "update", "remove")
 * @param {Array(String)|null}      fetch       `fetch` property to use
 * @param {Function}                func        The function
 */

addFuncForAll = function addFuncForAll(collections, allowOrDeny, types, fetch, func) {
  // We always disable transformation, but we transform for specific
  // rules upon running our deny function if requested.
  var rules = {
    transform: null
  };

  if (_.isArray(fetch)) {
    rules.fetch = fetch;
  }

  _.each(types, function (t) {
    rules[t] = func;
  });

  _.each(collections, function (c) {
    c[allowOrDeny](rules);
  });
};
/**
 * Creates the allow or deny function for the given collections if not already created. This ensures that this package only ever creates up to one allow and one deny per collection.
 * @param   {String}                  allowOrDeny "allow" or "deny"
 * @param   {Array(Mongo.Collection)} collections An array of collections
 * @param   {Array(String)}           types       An array of types ("insert", "update", "remove")
 * @param   {Array(String)|null}      fetch       `fetch` property to use
 * @param   {Function}                func        The function
 */


ensureCreated = function ensureCreated(allowOrDeny, collections, types, fetch, func) {
  _.each(types, t => {
    // Ignore "read"
    if (!_.contains(['insert', 'update', 'remove', 'download'], t)) return;
    collections = _.reject(collections, c => {
      return _.has(created[allowOrDeny][t], getCollectionName(c));
    });
    addFuncForAll(collections, allowOrDeny, [t], null, func); // mark that we've defined function for collection-type combo

    _.each(collections, c => {
      created[allowOrDeny][t][getCollectionName(c)] = true;
    });
  });
};
/**
 * Sets up default allow functions for the collections and types.
 * @param   {Array(Mongo.Collection)} collections Array of Mongo.Collection instances
 * @param   {Array(String)}           types       Array of types ("insert", "update", "remove")
 */


ensureDefaultAllow = function ensureDefaultAllow(collections, types) {
  ensureCreated("allow", collections, types, [], function () {
    return true;
  });
};
/**
 * Return only those rules that apply to the given collection and operation type
 */


getRulesForCollectionAndType = function getRulesForCollectionAndType(collectionName, type) {
  var rules = rulesByCollection[collectionName] || [];
  return _.select(rules, function (rule) {
    return _.contains(rule._types, type);
  });
};

getCollectionName = function getCollectionName(collection) {
  // CollectionFS has underlying collection on `files` property
  return collection._name || collection.files && collection.files._name;
};
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"Security.js":function(){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// packages/ongoworks_security/lib/server/Security.js                                                                //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
// The `Security` object is exported and provides the package API
Security = {
  // Putting these on the exported object allows package users to override if necessary
  errorMessages: {
    multipleCan: 'You may not combine more than one insert, update, or remove on a Security.can chain',
    notAllowed: 'Action not allowed',
    requiresDefinition: 'Security.defineMethod requires a "definition" argument',
    requiresAllow: 'Security.defineMethod requires an "allow" function',
    collectionsArg: 'The collections argument must be a Mongo.Collection instance or an array of them',
    noCollectionOrType: 'At a minimum, you must call permit and collections methods for a security rule.'
  },
  // the starting point of the chain
  permit: function permit(types) {
    return new Security.Rule(types);
  },
  can: function can(userId) {
    return new Security.Check(userId);
  },
  defineMethod: function securityDefineMethod(name, definition) {
    // Check whether a rule with the given name already exists; can't overwrite
    if (Security.Rule.prototype[name]) {
      throw new Error('A security method with the name "' + name + '" has already been defined');
    }

    if (!definition) throw new Error(Security.errorMessages.requiresDefinition); // If "deny" is used, convert to "allow" for backwards compatibility

    if (definition.deny) {
      definition.allow = (...args) => {
        return !definition.deny(...args);
      };
    } // Make sure the definition argument is an object that has an `allow` property


    if (!definition.allow) throw new Error(Security.errorMessages.requiresAllow); // Wrap transform, if provided

    if (definition.transform) {
      definition.transform = LocalCollection.wrapTransform(definition.transform);
    }

    Security.Rule.prototype[name] = function (arg) {
      this._restrictions.push({
        definition,
        arg
      });

      return this;
    };
  }
};

Mongo.Collection.prototype.permit = function (types) {
  return Security.permit(types).collections(this);
};
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"Security.Rule.js":function(){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// packages/ongoworks_security/lib/server/Security.Rule.js                                                           //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
Security.Rule = class {
  constructor(types) {
    if (!_.isArray(types)) types = [types];
    this._types = types;
    this._restrictions = [];
  }

  collections(collections) {
    // Make sure the `collections` argument is either a `Mongo.Collection` instance or
    // an array of them. If it's a single collection, convert it to a one-item array.
    if (!_.isArray(collections)) collections = [collections]; // Keep list keyed by collection name

    _.each(collections, collection => {
      if (!(collection instanceof Mongo.Collection) && // CollectionFS has underlying collection on `files` property
      !(collection.files instanceof Mongo.Collection)) {
        throw new Error(Security.errorMessages.collectionsArg);
      } // CollectionFS has underlying collection on `files` property


      const collectionName = getCollectionName(collection);
      rulesByCollection[collectionName] = rulesByCollection[collectionName] || [];
      rulesByCollection[collectionName].push(this);
    });

    this._collections = collections;
    return this;
  }

  combinedFetch() {
    // We need a combined `fetch` array. The `fetch` is optional and can be either an array
    // or a function that takes the argument passed to the restriction method and returns an array.
    let fetch = [];

    _.every(this._restrictions, restriction => {
      if (_.isArray(restriction.definition.fetch)) {
        fetch = _.union(fetch, restriction.definition.fetch);
      } else if (typeof restriction.definition.fetch === "function") {
        fetch = _.union(fetch, restriction.definition.fetch(restriction.arg));
      } else if (!restriction.definition.hasOwnProperty('fetch')) {
        // If `fetch` property isn't present, we should fetch the full doc.
        fetch = null;
        return false; // Exit loop
      }

      return true;
    });

    return fetch;
  }

  allowInClientCode() {
    if (!this._collections || !this._types) throw new Error(Security.errorMessages.noCollectionOrType);
    ensureSecureDeny(this._collections, this._types);
  }

  allow(type, collection, userId, doc, modifier, ...args) {
    let fields;
    if (type === 'update') fields = computeChangedFieldsFromModifier(modifier); // Loop through all defined restrictions. Restrictions are additive for this chained
    // rule, so if any allow function returns false, this function should return false.

    return _.every(this._restrictions, restriction => {
      // Clone the doc in case we need to transform it. Transformations
      // should apply to only the one restriction.
      let loopDoc = _.clone(doc); // If transform is a function, apply that


      let transform = restriction.definition.transform;

      if (transform !== null) {
        transform = transform || collection._transform;

        if (typeof transform === 'function') {
          let addedRandomId = false;

          if (type === 'insert' && !loopDoc._id) {
            // The wrapped transform requires an _id, but we
            // don't have access to the generatedId from Meteor API,
            // so we'll fudge one and then remove it.
            loopDoc._id = Random.id();
            addedRandomId = true;
          }

          loopDoc = transform(loopDoc);
          if (addedRandomId) delete loopDoc._id;
        }
      }

      return restriction.definition.allow(type, restriction.arg, userId, loopDoc, fields, modifier, ...args);
    });
  }

};

function ensureSecureDeny(collections, types) {
  // If we haven't yet done so, set up a default, permissive `allow` function for all of
  // the given collections and types. We control all security through `deny` functions only, but
  // there must first be at least one `allow` function for each collection or all writes
  // will be denied.
  ensureDefaultAllow(collections, types);

  _.each(types, t => {
    _.each(collections, collection => {
      ensureCreated('deny', [collection], [t], null, function (...args) {
        const userId = args.shift(); // If type is update, remove the `fields` argument. We will create our own
        // for consistency.

        if (t === 'update') args = [args[0], args[2]];
        return !Security.can(userId)[t](...args).for(collection).check();
      });
    });
  });
}

function computeChangedFieldsFromModifier(modifier) {
  var fields = []; // This is the same logic Meteor's mongo package uses in
  // https://github.com/meteor/meteor/blob/devel/packages/mongo/collection.js

  _.each(modifier, function (params) {
    _.each(_.keys(params), function (field) {
      // treat dotted fields as if they are replacing their
      // top-level part
      if (field.indexOf('.') !== -1) field = field.substring(0, field.indexOf('.')); // record the field we are trying to change

      if (!_.contains(fields, field)) fields.push(field);
    });
  });

  return fields;
}
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"Security.Check.js":function(){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// packages/ongoworks_security/lib/server/Security.Check.js                                                          //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
Security.Check = class {
  constructor(userId) {
    this.userId = userId || null;
  }

  for(collection) {
    this.collection = collection;
    this.collectionName = getCollectionName(collection);
    return this;
  }

  insert(doc, ...args) {
    if (this.type) throw new Error(Security.errorMessages.multipleCan);
    this.type = 'insert';
    this.doc = doc;
    this.args = args;
    return this;
  }

  update(doc, modifier, ...args) {
    if (this.type) throw new Error(Security.errorMessages.multipleCan);
    this.type = 'update';
    this.doc = doc;
    this.modifier = modifier;
    this.args = args;
    return this;
  }

  remove(doc, ...args) {
    if (this.type) throw new Error(Security.errorMessages.multipleCan);
    this.type = 'remove';
    this.doc = doc;
    this.args = args;
    return this;
  }

  read(doc, ...args) {
    if (this.type) throw new Error(Security.errorMessages.multipleCan);
    this.type = 'read';
    this.doc = doc;
    this.args = args;
    return this;
  }

  download(doc, ...args) {
    if (this.type) throw new Error(Security.errorMessages.multipleCan);
    this.type = 'download';
    this.doc = doc;
    this.args = args;
    return this;
  } // EXAMPLES:
  // Security.can(userId).insert(doc).for(MyCollection).check()
  // Security.can(userId).update(id, modifier).for(MyCollection).check()
  // Security.can(userId).remove(id).for(MyCollection).check()


  check() {
    // Select only those rules that apply to this operation type
    const rules = getRulesForCollectionAndType(this.collectionName, this.type); // If this.doc is an ID, we will look up the doc, fetching only the fields needed.
    // To find out which fields are needed, we will combine all the `fetch` arrays from
    // all the restrictions in all the rules.

    if (typeof this.doc === 'string' || this.doc instanceof MongoID.ObjectID) {
      let fields = {};

      _.every(rules, rule => {
        const fetch = rule.combinedFetch();

        if (fetch === null) {
          fields = null;
          return false; // Exit loop
        }

        rule.combinedFetch().forEach(field => {
          fields[field] = 1;
        });
        return true;
      });

      let options = {};

      if (fields) {
        if (_.isEmpty(fields)) {
          options = {
            _id: 1
          };
        } else {
          options = {
            fields
          };
        }
      }

      this.doc = this.collection.findOne(this.doc, options);
    } // Loop through all defined rules for this collection. There is an OR relationship among
    // all rules for the collection, so if any "allow" function DO return true, we allow.


    return _.any(rules, rule => rule.allow(this.type, this.collection, this.userId, this.doc, this.modifier, ...this.args));
  } // EXAMPLES:
  // Security.can(userId).insert(doc).for(MyCollection).throw()
  // Security.can(userId).update(id, modifier).for(MyCollection).throw()
  // Security.can(userId).remove(id).for(MyCollection).throw()


  throw() {
    if (!this.check()) throw new Meteor.Error('access-denied', Security.errorMessages.notAllowed);
  }

};
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"builtInRules.js":function(){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// packages/ongoworks_security/lib/builtInRules.js                                                                   //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
/*
 * This file defines built-in restriction methods
 */

/*
 * No one
 */
Security.defineMethod("never", {
  fetch: [],
  transform: null,

  allow() {
    return false;
  }

});
/*
 * Logged In
 */

Security.defineMethod("ifLoggedIn", {
  fetch: [],
  transform: null,

  allow(type, arg, userId) {
    return !!userId;
  }

});
/*
 * Specific User ID
 */

Security.defineMethod("ifHasUserId", {
  fetch: [],
  transform: null,

  allow(type, arg, userId) {
    return userId === arg;
  }

});
/*
 * Specific Roles
 */

/*
 * alanning:roles support
 */

if (Package && Package["alanning:roles"]) {
  var Roles = Package["alanning:roles"].Roles;
  Security.defineMethod("ifHasRole", {
    fetch: [],
    transform: null,

    allow(type, arg, userId) {
      if (!arg) throw new Error('ifHasRole security rule method requires an argument');

      if (arg.role) {
        return Roles.userIsInRole(userId, arg.role, arg.group);
      } else {
        return Roles.userIsInRole(userId, arg);
      }
    }

  });
}
/*
 * nicolaslopezj:roles support
 * Note: doesn't support groups
 */


if (Package && Package["nicolaslopezj:roles"]) {
  var Roles = Package["nicolaslopezj:roles"].Roles;
  Security.defineMethod("ifHasRole", {
    fetch: [],
    transform: null,

    allow(type, arg, userId) {
      if (!arg) throw new Error('ifHasRole security rule method requires an argument');
      return Roles.userHasRole(userId, arg);
    }

  });
}
/*
 * Specific Properties
 */


Security.defineMethod("onlyProps", {
  fetch: [],
  transform: null,

  allow(type, arg, userId, doc, fieldNames) {
    if (!_.isArray(arg)) arg = [arg];
    fieldNames = fieldNames || _.keys(doc);
    return _.every(fieldNames, function (fieldName) {
      return _.contains(arg, fieldName);
    });
  }

});
Security.defineMethod("exceptProps", {
  fetch: [],
  transform: null,

  allow(type, arg, userId, doc, fieldNames) {
    if (!_.isArray(arg)) arg = [arg];
    fieldNames = fieldNames || _.keys(doc);
    return !_.any(fieldNames, function (fieldName) {
      return _.contains(arg, fieldName);
    });
  }

});
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});
require("/node_modules/meteor/ongoworks:security/lib/server/utility.js");
require("/node_modules/meteor/ongoworks:security/lib/server/Security.js");
require("/node_modules/meteor/ongoworks:security/lib/server/Security.Rule.js");
require("/node_modules/meteor/ongoworks:security/lib/server/Security.Check.js");
require("/node_modules/meteor/ongoworks:security/lib/builtInRules.js");

/* Exports */
Package._define("ongoworks:security", {
  Security: Security
});

})();

//# sourceURL=meteor://💻app/packages/ongoworks_security.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvb25nb3dvcmtzOnNlY3VyaXR5L2xpYi9zZXJ2ZXIvdXRpbGl0eS5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvb25nb3dvcmtzOnNlY3VyaXR5L2xpYi9zZXJ2ZXIvU2VjdXJpdHkuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL29uZ293b3JrczpzZWN1cml0eS9saWIvc2VydmVyL1NlY3VyaXR5LlJ1bGUuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL29uZ293b3JrczpzZWN1cml0eS9saWIvc2VydmVyL1NlY3VyaXR5LkNoZWNrLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9vbmdvd29ya3M6c2VjdXJpdHkvbGliL2J1aWx0SW5SdWxlcy5qcyJdLCJuYW1lcyI6WyJydWxlc0J5Q29sbGVjdGlvbiIsImNyZWF0ZWQiLCJhbGxvdyIsImluc2VydCIsInVwZGF0ZSIsInJlbW92ZSIsImRvd25sb2FkIiwiZGVueSIsImFkZEZ1bmNGb3JBbGwiLCJjb2xsZWN0aW9ucyIsImFsbG93T3JEZW55IiwidHlwZXMiLCJmZXRjaCIsImZ1bmMiLCJydWxlcyIsInRyYW5zZm9ybSIsIl8iLCJpc0FycmF5IiwiZWFjaCIsInQiLCJjIiwiZW5zdXJlQ3JlYXRlZCIsImNvbnRhaW5zIiwicmVqZWN0IiwiaGFzIiwiZ2V0Q29sbGVjdGlvbk5hbWUiLCJlbnN1cmVEZWZhdWx0QWxsb3ciLCJnZXRSdWxlc0ZvckNvbGxlY3Rpb25BbmRUeXBlIiwiY29sbGVjdGlvbk5hbWUiLCJ0eXBlIiwic2VsZWN0IiwicnVsZSIsIl90eXBlcyIsImNvbGxlY3Rpb24iLCJfbmFtZSIsImZpbGVzIiwiU2VjdXJpdHkiLCJlcnJvck1lc3NhZ2VzIiwibXVsdGlwbGVDYW4iLCJub3RBbGxvd2VkIiwicmVxdWlyZXNEZWZpbml0aW9uIiwicmVxdWlyZXNBbGxvdyIsImNvbGxlY3Rpb25zQXJnIiwibm9Db2xsZWN0aW9uT3JUeXBlIiwicGVybWl0IiwiUnVsZSIsImNhbiIsInVzZXJJZCIsIkNoZWNrIiwiZGVmaW5lTWV0aG9kIiwic2VjdXJpdHlEZWZpbmVNZXRob2QiLCJuYW1lIiwiZGVmaW5pdGlvbiIsInByb3RvdHlwZSIsIkVycm9yIiwiYXJncyIsIkxvY2FsQ29sbGVjdGlvbiIsIndyYXBUcmFuc2Zvcm0iLCJhcmciLCJfcmVzdHJpY3Rpb25zIiwicHVzaCIsIk1vbmdvIiwiQ29sbGVjdGlvbiIsImNvbnN0cnVjdG9yIiwiX2NvbGxlY3Rpb25zIiwiY29tYmluZWRGZXRjaCIsImV2ZXJ5IiwicmVzdHJpY3Rpb24iLCJ1bmlvbiIsImhhc093blByb3BlcnR5IiwiYWxsb3dJbkNsaWVudENvZGUiLCJlbnN1cmVTZWN1cmVEZW55IiwiZG9jIiwibW9kaWZpZXIiLCJmaWVsZHMiLCJjb21wdXRlQ2hhbmdlZEZpZWxkc0Zyb21Nb2RpZmllciIsImxvb3BEb2MiLCJjbG9uZSIsIl90cmFuc2Zvcm0iLCJhZGRlZFJhbmRvbUlkIiwiX2lkIiwiUmFuZG9tIiwiaWQiLCJzaGlmdCIsImZvciIsImNoZWNrIiwicGFyYW1zIiwia2V5cyIsImZpZWxkIiwiaW5kZXhPZiIsInN1YnN0cmluZyIsInJlYWQiLCJNb25nb0lEIiwiT2JqZWN0SUQiLCJmb3JFYWNoIiwib3B0aW9ucyIsImlzRW1wdHkiLCJmaW5kT25lIiwiYW55IiwidGhyb3ciLCJNZXRlb3IiLCJQYWNrYWdlIiwiUm9sZXMiLCJyb2xlIiwidXNlcklzSW5Sb2xlIiwiZ3JvdXAiLCJ1c2VySGFzUm9sZSIsImZpZWxkTmFtZXMiLCJmaWVsZE5hbWUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBRUFBLG9CQUFvQixFQUFwQjtBQUVBLElBQUlDLFVBQVU7QUFDWkMsU0FBTztBQUNMQyxZQUFRLEVBREg7QUFFTEMsWUFBUSxFQUZIO0FBR0xDLFlBQVEsRUFISDtBQUlMQyxjQUFVLEVBSkwsQ0FJUTs7QUFKUixHQURLO0FB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Q0FBUDtBQUNELEtBRk0sQ0FBUDtBQUdEOztBQVhnQyxDQUFuQztBQWNBeEUsU0FBU2EsWUFBVCxDQUFzQixhQUF0QixFQUFxQztBQUNuQ3JDLFNBQU8sRUFENEI7QUFFbkNHLGFBQVcsSUFGd0I7O0FBR25DYixRQUFNMkIsSUFBTixFQUFZNkIsR0FBWixFQUFpQlgsTUFBakIsRUFBeUJ5QixHQUF6QixFQUE4Qm1DLFVBQTlCLEVBQTBDO0FBQ3hDLFFBQUksQ0FBQzNGLEVBQUVDLE9BQUYsQ0FBVXlDLEdBQVYsQ0FBTCxFQUFxQkEsTUFBTSxDQUFDQSxHQUFELENBQU47QUFFckJpRCxpQkFBYUEsY0FBYzNGLEVBQUV1RSxJQUFGLENBQU9mLEdBQVAsQ0FBM0I7QUFFQSxXQUFPLENBQUN4RCxFQUFFa0YsR0FBRixDQUFNUyxVQUFOLEVBQWtCLFVBQVVDLFNBQVYsRUFBcUI7QUFDN0MsYUFBTzVGLEVBQUVNLFFBQUYsQ0FBV29DLEdBQVgsRUFBZ0JrRCxTQUFoQixDQUFQO0FBQ0QsS0FGTyxDQUFSO0FBR0Q7O0FBWGtDLENBQXJDLEUiLCJmaWxlIjoiL3BhY2thZ2VzL29uZ293b3Jrc19zZWN1cml0eS5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8qIGdsb2JhbCBfLCBydWxlc0J5Q29sbGVjdGlvbjp0cnVlLCBhZGRGdW5jRm9yQWxsOnRydWUsIGVuc3VyZUNyZWF0ZWQ6dHJ1ZSwgZW5zdXJlRGVmYXVsdEFsbG93OnRydWUgKi9cblxucnVsZXNCeUNvbGxlY3Rpb24gPSB7fTtcblxudmFyIGNyZWF0ZWQgPSB7XG4gIGFsbG93OiB7XG4gICAgaW5zZXJ0OiB7fSxcbiAgICB1cGRhdGU6IHt9LFxuICAgIHJlbW92ZToge30sXG4gICAgZG93bmxvYWQ6IHt9IC8vIGZvciB1c2Ugd2l0aCBDb2xsZWN0aW9uRlMgcGFja2FnZXNcbiAgfSxcbiAgZGVueToge1xuICAgIGluc2VydDoge30sXG4gICAgdXBkYXRlOiB7fSxcbiAgICByZW1vdmU6IHt9LFxuICAgIGRvd25sb2FkOiB7fSAvLyBmb3IgdXNlIHdpdGggQ29sbGVjdGlvbkZTIHBhY2thZ2VzXG4gIH1cbn07XG5cbi8qKlxuICogQWRkcyB0aGUgZ2l2ZW4gZnVuY3Rpb24gYXMgYW4gYWxsb3cgb3IgZGVueSBmdW5jdGlvbiBmb3IgYWxsIHNwZWNpZmllZCBjb2xsZWN0aW9ucyBhbmQgdHlwZXMuXG4gKiBAcGFyYW0ge0FycmF5KE1vbmdvLkNvbGxlY3Rpb24pfSBjb2xsZWN0aW9ucyBBcnJheSBvZiBNb25nby5Db2xsZWN0aW9uIGluc3RhbmNlc1xuICogQHBhcmFtIHtTdHJpbmd9ICAgICAgICAgICAgICAgICAgYWxsb3dPckRlbnkgXCJhbGxvd1wiIG9yIFwiZGVueVwiXG4gKiBAcGFyYW0ge0FycmF5KFN0cmluZyl9ICAgICAgICAgICB0eXBlcyAgICAgICBBcnJheSBvZiB0eXBlcyAoXCJpbnNlcnRcIiwgXCJ1cGRhdGVcIiwgXCJyZW1vdmVcIilcbiAqIEBwYXJhbSB7QXJyYXkoU3RyaW5nKXxudWxsfSAgICAgIGZldGNoICAgICAgIGBmZXRjaGAgcHJvcGVydHkgdG8gdXNlXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSAgICAgICAgICAgICAgICBmdW5jICAgICAgICBUaGUgZnVuY3Rpb25cbiAqL1xuYWRkRnVuY0ZvckFsbCA9IGZ1bmN0aW9uIGFkZEZ1bmNGb3JBbGwoY29sbGVjdGlvbnMsIGFsbG93T3JEZW55LCB0eXBlcywgZmV0Y2gsIGZ1bmMpIHtcbiAgLy8gV2UgYWx3YXlzIGRpc2FibGUgdHJhbnNmb3JtYXRpb24sIGJ1dCB3ZSB0cmFuc2Zvcm0gZm9yIHNwZWNpZmljXG4gIC8vIHJ1bGVzIHVwb24gcnVubmluZyBvdXIgZGVueSBmdW5jdGlvbiBpZiByZXF1ZXN0ZWQuXG4gIHZhciBydWxlcyA9IHt0cmFuc2Zvcm06IG51bGx9O1xuICBpZiAoXy5pc0FycmF5KGZldGNoKSkge1xuICAgIHJ1bGVzLmZldGNoID0gZmV0Y2g7XG4gIH1cbiAgXy5lYWNoKHR5cGVzLCBmdW5jdGlvbiAodCkge1xuICAgIHJ1bGVzW3RdID0gZnVuYztcbiAgfSk7XG4gIF8uZWFjaChjb2xsZWN0aW9ucywgZnVuY3Rpb24gKGMpIHtcbiAgICBjW2FsbG93T3JEZW55XShydWxlcyk7XG4gIH0pO1xufTtcblxuLyoqXG4gKiBDcmVhdGVzIHRoZSBhbGxvdyBvciBkZW55IGZ1bmN0aW9uIGZvciB0aGUgZ2l2ZW4gY29sbGVjdGlvbnMgaWYgbm90IGFscmVhZHkgY3JlYXRlZC4gVGhpcyBlbnN1cmVzIHRoYXQgdGhpcyBwYWNrYWdlIG9ubHkgZXZlciBjcmVhdGVzIHVwIHRvIG9uZSBhbGxvdyBhbmQgb25lIGRlbnkgcGVyIGNvbGxlY3Rpb24uXG4gKiBAcGFyYW0gICB7U3RyaW5nfSAgICAgICAgICAgICAgICAgIGFsbG93T3JEZW55IFwiYWxsb3dcIiBvciBcImRlbnlcIlxuICogQHBhcmFtICAge0FycmF5KE1vbmdvLkNvbGxlY3Rpb24pfSBjb2xsZWN0aW9ucyBBbiBhcnJheSBvZiBjb2xsZWN0aW9uc1xuICogQHBhcmFtICAge0FycmF5KFN0cmluZyl9ICAgICAgICAgICB0eXBlcyAgICAgICBBbiBhcnJheSBvZiB0eXBlcyAoXCJpbnNlcnRcIiwgXCJ1cGRhdGVcIiwgXCJyZW1vdmVcIilcbiAqIEBwYXJhbSAgIHtBcnJheShTdHJpbmcpfG51bGx9ICAgICAgZmV0Y2ggICAgICAgYGZldGNoYCBwcm9wZXJ0eSB0byB1c2VcbiAqIEBwYXJhbSAgIHtGdW5jdGlvbn0gICAgICAgICAgICAgICAgZnVuYyAgICAgICAgVGhlIGZ1bmN0aW9uXG4gKi9cbmVuc3VyZUNyZWF0ZWQgPSBmdW5jdGlvbiBlbnN1cmVDcmVhdGVkKGFsbG93T3JEZW55LCBjb2xsZWN0aW9ucywgdHlwZXMsIGZldGNoLCBmdW5jKSB7XG4gIF8uZWFjaCh0eXBlcywgdCA9PiB7XG4gICAgLy8gSWdub3JlIFwicmVhZFwiXG4gICAgaWYgKCFfLmNvbnRhaW5zKFsnaW5zZXJ0JywgJ3VwZGF0ZScsICdyZW1vdmUnLCAnZG93bmxvYWQnXSwgdCkpIHJldHVybjtcblxuICAgIGNvbGxlY3Rpb25zID0gXy5yZWplY3QoY29sbGVjdGlvbnMsIGMgPT4ge1xuICAgICAgcmV0dXJuIF8uaGFzKGNyZWF0ZWRbYWxsb3dPckRlbnldW3RdLCBnZXRDb2xsZWN0aW9uTmFtZShjKSk7XG4gICAgfSk7XG4gICAgYWRkRnVuY0ZvckFsbChjb2xsZWN0aW9ucywgYWxsb3dPckRlbnksIFt0XSwgbnVsbCwgZnVuYyk7XG4gICAgLy8gbWFyayB0aGF0IHdlJ3ZlIGRlZmluZWQgZnVuY3Rpb24gZm9yIGNvbGxlY3Rpb24tdHlwZSBjb21ib1xuICAgIF8uZWFjaChjb2xsZWN0aW9ucywgYyA9PiB7XG4gICAgICBjcmVhdGVkW2FsbG93T3JEZW55XVt0XVtnZXRDb2xsZWN0aW9uTmFtZShjKV0gPSB0cnVlO1xuICAgIH0pO1xuICB9KTtcbn07XG5cbi8qKlxuICogU2V0cyB1cCBkZWZhdWx0IGFsbG93IGZ1bmN0aW9ucyBmb3IgdGhlIGNvbGxlY3Rpb25zIGFuZCB0eXBlcy5cbiAqIEBwYXJhbSAgIHtBcnJheShNb25nby5Db2xsZWN0aW9uKX0gY29sbGVjdGlvbnMgQXJyYXkgb2YgTW9uZ28uQ29sbGVjdGlvbiBpbnN0YW5jZXNcbiAqIEBwYXJhbSAgIHtBcnJheShTdHJpbmcpfSAgICAgICAgICAgdHlwZXMgICAgICAgQXJyYXkgb2YgdHlwZXMgKFwiaW5zZXJ0XCIsIFwidXBkYXRlXCIsIFwicmVtb3ZlXCIpXG4gKi9cbmVuc3VyZURlZmF1bHRBbGxvdyA9IGZ1bmN0aW9uIGVuc3VyZURlZmF1bHRBbGxvdyhjb2xsZWN0aW9ucywgdHlwZXMpIHtcbiAgZW5zdXJlQ3JlYXRlZChcImFsbG93XCIsIGNvbGxlY3Rpb25zLCB0eXBlcywgW10sIGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSk7XG59O1xuXG4vKipcbiAqIFJldHVybiBvbmx5IHRob3NlIHJ1bGVzIHRoYXQgYXBwbHkgdG8gdGhlIGdpdmVuIGNvbGxlY3Rpb24gYW5kIG9wZXJhdGlvbiB0eXBlXG4gKi9cbmdldFJ1bGVzRm9yQ29sbGVjdGlvbkFuZFR5cGUgPSBmdW5jdGlvbiBnZXRSdWxlc0ZvckNvbGxlY3Rpb25BbmRUeXBlKGNvbGxlY3Rpb25OYW1lLCB0eXBlKSB7XG4gIHZhciBydWxlcyA9IHJ1bGVzQnlDb2xsZWN0aW9uW2NvbGxlY3Rpb25OYW1lXSB8fCBbXTtcbiAgcmV0dXJuIF8uc2VsZWN0KHJ1bGVzLCBmdW5jdGlvbiAocnVsZSkge1xuICAgIHJldHVybiBfLmNvbnRhaW5zKHJ1bGUuX3R5cGVzLCB0eXBlKTtcbiAgfSk7XG59O1xuXG5nZXRDb2xsZWN0aW9uTmFtZSA9IGZ1bmN0aW9uIGdldENvbGxlY3Rpb25OYW1lKGNvbGxlY3Rpb24pIHtcbiAgLy8gQ29sbGVjdGlvbkZTIGhhcyB1bmRlcmx5aW5nIGNvbGxlY3Rpb24gb24gYGZpbGVzYCBwcm9wZXJ0eVxuICByZXR1cm4gY29sbGVjdGlvbi5fbmFtZSB8fCAoY29sbGVjdGlvbi5maWxlcyAmJiBjb2xsZWN0aW9uLmZpbGVzLl9uYW1lKTtcbn07XG4iLCIvLyBUaGUgYFNlY3VyaXR5YCBvYmplY3QgaXMgZXhwb3J0ZWQgYW5kIHByb3ZpZGVzIHRoZSBwYWNrYWdlIEFQSVxuU2VjdXJpdHkgPSB7XG4gIC8vIFB1dHRpbmcgdGhlc2Ugb24gdGhlIGV4cG9ydGVkIG9iamVjdCBhbGxvd3MgcGFja2FnZSB1c2VycyB0byBvdmVycmlkZSBpZiBuZWNlc3NhcnlcbiAgZXJyb3JNZXNzYWdlczoge1xuICAgIG11bHRpcGxlQ2FuOiAnWW91IG1heSBub3QgY29tYmluZSBtb3JlIHRoYW4gb25lIGluc2VydCwgdXBkYXRlLCBvciByZW1vdmUgb24gYSBTZWN1cml0eS5jYW4gY2hhaW4nLFxuICAgIG5vdEFsbG93ZWQ6ICdBY3Rpb24gbm90IGFsbG93ZWQnLFxuICAgIHJlcXVpcmVzRGVmaW5pdGlvbjogJ1NlY3VyaXR5LmRlZmluZU1ldGhvZCByZXF1aXJlcyBhIFwiZGVmaW5pdGlvblwiIGFyZ3VtZW50JyxcbiAgICByZXF1aXJlc0FsbG93OiAnU2VjdXJpdHkuZGVmaW5lTWV0aG9kIHJlcXVpcmVzIGFuIFwiYWxsb3dcIiBmdW5jdGlvbicsXG4gICAgY29sbGVjdGlvbnNBcmc6ICdUaGUgY29sbGVjdGlvbnMgYXJndW1lbnQgbXVzdCBiZSBhIE1vbmdvLkNvbGxlY3Rpb24gaW5zdGFuY2Ugb3IgYW4gYXJyYXkgb2YgdGhlbScsXG4gICAgbm9Db2xsZWN0aW9uT3JUeXBlOiAnQXQgYSBtaW5pbXVtLCB5b3UgbXVzdCBjYWxsIHBlcm1pdCBhbmQgY29sbGVjdGlvbnMgbWV0aG9kcyBmb3IgYSBzZWN1cml0eSBydWxlLicsXG4gIH0sXG4gIC8vIHRoZSBzdGFydGluZyBwb2ludCBvZiB0aGUgY2hhaW5cbiAgcGVybWl0OiBmdW5jdGlvbiBwZXJtaXQodHlwZXMpIHtcbiAgICByZXR1cm4gbmV3IFNlY3VyaXR5LlJ1bGUodHlwZXMpO1xuICB9LFxuICBjYW46IGZ1bmN0aW9uIGNhbih1c2VySWQpIHtcbiAgICByZXR1cm4gbmV3IFNlY3VyaXR5LkNoZWNrKHVzZXJJZCk7XG4gIH0sXG4gIGRlZmluZU1ldGhvZDogZnVuY3Rpb24gc2VjdXJpdHlEZWZpbmVNZXRob2QobmFtZSwgZGVmaW5pdGlvbikge1xuICAgIC8vIENoZWNrIHdoZXRoZXIgYSBydWxlIHdpdGggdGhlIGdpdmVuIG5hbWUgYWxyZWFkeSBleGlzdHM7IGNhbid0IG92ZXJ3cml0ZVxuICAgIGlmIChTZWN1cml0eS5SdWxlLnByb3RvdHlwZVtuYW1lXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdBIHNlY3VyaXR5IG1ldGhvZCB3aXRoIHRoZSBuYW1lIFwiJyArIG5hbWUgKyAnXCIgaGFzIGFscmVhZHkgYmVlbiBkZWZpbmVkJyk7XG4gICAgfVxuICAgIGlmICghZGVmaW5pdGlvbikgdGhyb3cgbmV3IEVycm9yKFNlY3VyaXR5LmVycm9yTWVzc2FnZXMucmVxdWlyZXNEZWZpbml0aW9uKTtcbiAgICAvLyBJZiBcImRlbnlcIiBpcyB1c2VkLCBjb252ZXJ0IHRvIFwiYWxsb3dcIiBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHlcbiAgICBpZiAoZGVmaW5pdGlvbi5kZW55KSB7XG4gICAgICBkZWZpbml0aW9uLmFsbG93ID0gKC4uLmFyZ3MpID0+IHtcbiAgICAgICAgcmV0dXJuICFkZWZpbml0aW9uLmRlbnkoLi4uYXJncyk7XG4gICAgICB9O1xuICAgIH1cbiAgICAvLyBNYWtlIHN1cmUgdGhlIGRlZmluaXRpb24gYXJndW1lbnQgaXMgYW4gb2JqZWN0IHRoYXQgaGFzIGFuIGBhbGxvd2AgcHJvcGVydHlcbiAgICBpZiAoIWRlZmluaXRpb24uYWxsb3cpIHRocm93IG5ldyBFcnJvcihTZWN1cml0eS5lcnJvck1lc3NhZ2VzLnJlcXVpcmVzQWxsb3cpO1xuICAgIC8vIFdyYXAgdHJhbnNmb3JtLCBpZiBwcm92aWRlZFxuICAgIGlmIChkZWZpbml0aW9uLnRyYW5zZm9ybSkge1xuICAgICAgZGVmaW5pdGlvbi50cmFuc2Zvcm0gPSBMb2NhbENvbGxlY3Rpb24ud3JhcFRyYW5zZm9ybShkZWZpbml0aW9uLnRyYW5zZm9ybSk7XG4gICAgfVxuICAgIFNlY3VyaXR5LlJ1bGUucHJvdG90eXBlW25hbWVdID0gZnVuY3Rpb24gKGFyZykge1xuICAgICAgdGhpcy5fcmVzdHJpY3Rpb25zLnB1c2goe1xuICAgICAgICBkZWZpbml0aW9uLFxuICAgICAgICBhcmcsXG4gICAgICB9KTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH07XG4gIH1cbn07XG5cbk1vbmdvLkNvbGxlY3Rpb24ucHJvdG90eXBlLnBlcm1pdCA9IGZ1bmN0aW9uICh0eXBlcykge1xuICByZXR1cm4gU2VjdXJpdHkucGVybWl0KHR5cGVzKS5jb2xsZWN0aW9ucyh0aGlzKTtcbn07XG4iLCJTZWN1cml0eS5SdWxlID0gY2xhc3Mge1xuICBjb25zdHJ1Y3Rvcih0eXBlcykge1xuICAgIGlmICghXy5pc0FycmF5KHR5cGVzKSkgdHlwZXMgPSBbdHlwZXNdO1xuICAgIHRoaXMuX3R5cGVzID0gdHlwZXM7XG4gICAgdGhpcy5fcmVzdHJpY3Rpb25zID0gW107XG4gIH1cblxuICBjb2xsZWN0aW9ucyhjb2xsZWN0aW9ucykge1xuICAgIC8vIE1ha2Ugc3VyZSB0aGUgYGNvbGxlY3Rpb25zYCBhcmd1bWVudCBpcyBlaXRoZXIgYSBgTW9uZ28uQ29sbGVjdGlvbmAgaW5zdGFuY2Ugb3JcbiAgICAvLyBhbiBhcnJheSBvZiB0aGVtLiBJZiBpdCdzIGEgc2luZ2xlIGNvbGxlY3Rpb24sIGNvbnZlcnQgaXQgdG8gYSBvbmUtaXRlbSBhcnJheS5cbiAgICBpZiAoIV8uaXNBcnJheShjb2xsZWN0aW9ucykpIGNvbGxlY3Rpb25zID0gW2NvbGxlY3Rpb25zXTtcblxuICAgIC8vIEtlZXAgbGlzdCBrZXllZCBieSBjb2xsZWN0aW9uIG5hbWVcbiAgICBfLmVhY2goY29sbGVjdGlvbnMsIGNvbGxlY3Rpb24gPT4ge1xuICAgICAgaWYgKCEoY29sbGVjdGlvbiBpbnN0YW5jZW9mIE1vbmdvLkNvbGxlY3Rpb24pICYmXG4gICAgICAgICAgLy8gQ29sbGVjdGlvbkZTIGhhcyB1bmRlcmx5aW5nIGNvbGxlY3Rpb24gb24gYGZpbGVzYCBwcm9wZXJ0eVxuICAgICAgICAhKGNvbGxlY3Rpb24uZmlsZXMgaW5zdGFuY2VvZiBNb25nby5Db2xsZWN0aW9uKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoU2VjdXJpdHkuZXJyb3JNZXNzYWdlcy5jb2xsZWN0aW9uc0FyZyk7XG4gICAgICB9XG4gICAgICAvLyBDb2xsZWN0aW9uRlMgaGFzIHVuZGVybHlpbmcgY29sbGVjdGlvbiBvbiBgZmlsZXNgIHByb3BlcnR5XG4gICAgICBjb25zdCBjb2xsZWN0aW9uTmFtZSA9IGdldENvbGxlY3Rpb25OYW1lKGNvbGxlY3Rpb24pO1xuICAgICAgcnVsZXNCeUNvbGxlY3Rpb25bY29sbGVjdGlvbk5hbWVdID0gcnVsZXNCeUNvbGxlY3Rpb25bY29sbGVjdGlvbk5hbWVdIHx8IFtdO1xuICAgICAgcnVsZXNCeUNvbGxlY3Rpb25bY29sbGVjdGlvbk5hbWVdLnB1c2godGhpcyk7XG4gICAgfSk7XG5cbiAgICB0aGlzLl9jb2xsZWN0aW9ucyA9IGNvbGxlY3Rpb25zO1xuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBjb21iaW5lZEZldGNoKCkge1xuICAgIC8vIFdlIG5lZWQgYSBjb21iaW5lZCBgZmV0Y2hgIGFycmF5LiBUaGUgYGZldGNoYCBpcyBvcHRpb25hbCBhbmQgY2FuIGJlIGVpdGhlciBhbiBhcnJheVxuICAgIC8vIG9yIGEgZnVuY3Rpb24gdGhhdCB0YWtlcyB0aGUgYXJndW1lbnQgcGFzc2VkIHRvIHRoZSByZXN0cmljdGlvbiBtZXRob2QgYW5kIHJldHVybnMgYW4gYXJyYXkuXG4gICAgbGV0IGZldGNoID0gW107XG4gICAgXy5ldmVyeSh0aGlzLl9yZXN0cmljdGlvbnMsIHJlc3RyaWN0aW9uID0+IHtcbiAgICAgIGlmIChfLmlzQXJyYXkocmVzdHJpY3Rpb24uZGVmaW5pdGlvbi5mZXRjaCkpIHtcbiAgICAgICAgZmV0Y2ggPSBfLnVuaW9uKGZldGNoLCByZXN0cmljdGlvbi5kZWZpbml0aW9uLmZldGNoKTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHJlc3RyaWN0aW9uLmRlZmluaXRpb24uZmV0Y2ggPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBmZXRjaCA9IF8udW5pb24oZmV0Y2gsIHJlc3RyaWN0aW9uLmRlZmluaXRpb24uZmV0Y2gocmVzdHJpY3Rpb24uYXJnKSk7XG4gICAgICB9IGVsc2UgaWYgKCFyZXN0cmljdGlvbi5kZWZpbml0aW9uLmhhc093blByb3BlcnR5KCdmZXRjaCcpKSB7XG4gICAgICAgIC8vIElmIGBmZXRjaGAgcHJvcGVydHkgaXNuJ3QgcHJlc2VudCwgd2Ugc2hvdWxkIGZldGNoIHRoZSBmdWxsIGRvYy5cbiAgICAgICAgZmV0Y2ggPSBudWxsO1xuICAgICAgICByZXR1cm4gZmFsc2U7IC8vIEV4aXQgbG9vcFxuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSk7XG4gICAgcmV0dXJuIGZldGNoO1xuICB9XG5cbiAgYWxsb3dJbkNsaWVudENvZGUoKSB7XG4gICAgaWYgKCF0aGlzLl9jb2xsZWN0aW9ucyB8fCAhdGhpcy5fdHlwZXMpIHRocm93IG5ldyBFcnJvcihTZWN1cml0eS5lcnJvck1lc3NhZ2VzLm5vQ29sbGVjdGlvbk9yVHlwZSk7XG4gICAgZW5zdXJlU2VjdXJlRGVueSh0aGlzLl9jb2xsZWN0aW9ucywgdGhpcy5fdHlwZXMpO1xuICB9XG5cbiAgYWxsb3codHlwZSwgY29sbGVjdGlvbiwgdXNlcklkLCBkb2MsIG1vZGlmaWVyLCAuLi5hcmdzKSB7XG4gICAgbGV0IGZpZWxkcztcbiAgICBpZiAodHlwZSA9PT0gJ3VwZGF0ZScpIGZpZWxkcyA9IGNvbXB1dGVDaGFuZ2VkRmllbGRzRnJvbU1vZGlmaWVyKG1vZGlmaWVyKTtcblxuICAgIC8vIExvb3AgdGhyb3VnaCBhbGwgZGVmaW5lZCByZXN0cmljdGlvbnMuIFJlc3RyaWN0aW9ucyBhcmUgYWRkaXRpdmUgZm9yIHRoaXMgY2hhaW5lZFxuICAgIC8vIHJ1bGUsIHNvIGlmIGFueSBhbGxvdyBmdW5jdGlvbiByZXR1cm5zIGZhbHNlLCB0aGlzIGZ1bmN0aW9uIHNob3VsZCByZXR1cm4gZmFsc2UuXG4gICAgcmV0dXJuIF8uZXZlcnkodGhpcy5fcmVzdHJpY3Rpb25zLCByZXN0cmljdGlvbiA9PiB7XG4gICAgICAvLyBDbG9uZSB0aGUgZG9jIGluIGNhc2Ugd2UgbmVlZCB0byB0cmFuc2Zvcm0gaXQuIFRyYW5zZm9ybWF0aW9uc1xuICAgICAgLy8gc2hvdWxkIGFwcGx5IHRvIG9ubHkgdGhlIG9uZSByZXN0cmljdGlvbi5cbiAgICAgIGxldCBsb29wRG9jID0gXy5jbG9uZShkb2MpO1xuXG4gICAgICAvLyBJZiB0cmFuc2Zvcm0gaXMgYSBmdW5jdGlvbiwgYXBwbHkgdGhhdFxuICAgICAgbGV0IHRyYW5zZm9ybSA9IHJlc3RyaWN0aW9uLmRlZmluaXRpb24udHJhbnNmb3JtO1xuICAgICAgaWYgKHRyYW5zZm9ybSAhPT0gbnVsbCkge1xuICAgICAgICB0cmFuc2Zvcm0gPSB0cmFuc2Zvcm0gfHwgY29sbGVjdGlvbi5fdHJhbnNmb3JtO1xuICAgICAgICBpZiAodHlwZW9mIHRyYW5zZm9ybSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGxldCBhZGRlZFJhbmRvbUlkID0gZmFsc2U7XG4gICAgICAgICAgaWYgKHR5cGUgPT09ICdpbnNlcnQnICYmICFsb29wRG9jLl9pZCkge1xuICAgICAgICAgICAgLy8gVGhlIHdyYXBwZWQgdHJhbnNmb3JtIHJlcXVpcmVzIGFuIF9pZCwgYnV0IHdlXG4gICAgICAgICAgICAvLyBkb24ndCBoYXZlIGFjY2VzcyB0byB0aGUgZ2VuZXJhdGVkSWQgZnJvbSBNZXRlb3IgQVBJLFxuICAgICAgICAgICAgLy8gc28gd2UnbGwgZnVkZ2Ugb25lIGFuZCB0aGVuIHJlbW92ZSBpdC5cbiAgICAgICAgICAgIGxvb3BEb2MuX2lkID0gUmFuZG9tLmlkKCk7XG4gICAgICAgICAgICBhZGRlZFJhbmRvbUlkID0gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgbG9vcERvYyA9IHRyYW5zZm9ybShsb29wRG9jKTtcbiAgICAgICAgICBpZiAoYWRkZWRSYW5kb21JZCkgZGVsZXRlIGxvb3BEb2MuX2lkO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXN0cmljdGlvbi5kZWZpbml0aW9uLmFsbG93KHR5cGUsIHJlc3RyaWN0aW9uLmFyZywgdXNlcklkLCBsb29wRG9jLCBmaWVsZHMsIG1vZGlmaWVyLCAuLi5hcmdzKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBlbnN1cmVTZWN1cmVEZW55KGNvbGxlY3Rpb25zLCB0eXBlcykge1xuICAvLyBJZiB3ZSBoYXZlbid0IHlldCBkb25lIHNvLCBzZXQgdXAgYSBkZWZhdWx0LCBwZXJtaXNzaXZlIGBhbGxvd2AgZnVuY3Rpb24gZm9yIGFsbCBvZlxuICAvLyB0aGUgZ2l2ZW4gY29sbGVjdGlvbnMgYW5kIHR5cGVzLiBXZSBjb250cm9sIGFsbCBzZWN1cml0eSB0aHJvdWdoIGBkZW55YCBmdW5jdGlvbnMgb25seSwgYnV0XG4gIC8vIHRoZXJlIG11c3QgZmlyc3QgYmUgYXQgbGVhc3Qgb25lIGBhbGxvd2AgZnVuY3Rpb24gZm9yIGVhY2ggY29sbGVjdGlvbiBvciBhbGwgd3JpdGVzXG4gIC8vIHdpbGwgYmUgZGVuaWVkLlxuICBlbnN1cmVEZWZhdWx0QWxsb3coY29sbGVjdGlvbnMsIHR5cGVzKTtcblxuICBfLmVhY2godHlwZXMsIHQgPT4ge1xuICAgIF8uZWFjaChjb2xsZWN0aW9ucywgY29sbGVjdGlvbiA9PiB7XG4gICAgICBlbnN1cmVDcmVhdGVkKCdkZW55JywgW2NvbGxlY3Rpb25dLCBbdF0sIG51bGwsIGZ1bmN0aW9uICguLi5hcmdzKSB7XG4gICAgICAgIGNvbnN0IHVzZXJJZCA9IGFyZ3Muc2hpZnQoKTtcblxuICAgICAgICAvLyBJZiB0eXBlIGlzIHVwZGF0ZSwgcmVtb3ZlIHRoZSBgZmllbGRzYCBhcmd1bWVudC4gV2Ugd2lsbCBjcmVhdGUgb3VyIG93blxuICAgICAgICAvLyBmb3IgY29uc2lzdGVuY3kuXG4gICAgICAgIGlmICh0ID09PSAndXBkYXRlJykgYXJncyA9IFthcmdzWzBdLCBhcmdzWzJdXTtcblxuICAgICAgICByZXR1cm4gIVNlY3VyaXR5LmNhbih1c2VySWQpW3RdKC4uLmFyZ3MpLmZvcihjb2xsZWN0aW9uKS5jaGVjaygpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBjb21wdXRlQ2hhbmdlZEZpZWxkc0Zyb21Nb2RpZmllcihtb2RpZmllcikge1xuICB2YXIgZmllbGRzID0gW107XG4gIC8vIFRoaXMgaXMgdGhlIHNhbWUgbG9naWMgTWV0ZW9yJ3MgbW9uZ28gcGFja2FnZSB1c2VzIGluXG4gIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL2Jsb2IvZGV2ZWwvcGFja2FnZXMvbW9uZ28vY29sbGVjdGlvbi5qc1xuICBfLmVhY2gobW9kaWZpZXIsIGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICBfLmVhY2goXy5rZXlzKHBhcmFtcyksIGZ1bmN0aW9uIChmaWVsZCkge1xuICAgICAgLy8gdHJlYXQgZG90dGVkIGZpZWxkcyBhcyBpZiB0aGV5IGFyZSByZXBsYWNpbmcgdGhlaXJcbiAgICAgIC8vIHRvcC1sZXZlbCBwYXJ0XG4gICAgICBpZiAoZmllbGQuaW5kZXhPZignLicpICE9PSAtMSlcbiAgICAgICAgZmllbGQgPSBmaWVsZC5zdWJzdHJpbmcoMCwgZmllbGQuaW5kZXhPZignLicpKTtcblxuICAgICAgLy8gcmVjb3JkIHRoZSBmaWVsZCB3ZSBhcmUgdHJ5aW5nIHRvIGNoYW5nZVxuICAgICAgaWYgKCFfLmNvbnRhaW5zKGZpZWxkcywgZmllbGQpKVxuICAgICAgICBmaWVsZHMucHVzaChmaWVsZCk7XG4gICAgfSk7XG4gIH0pO1xuICByZXR1cm4gZmllbGRzO1xufVxuIiwiU2VjdXJpdHkuQ2hlY2sgPSBjbGFzcyB7XG4gIGNvbnN0cnVjdG9yKHVzZXJJZCkge1xuICAgIHRoaXMudXNlcklkID0gdXNlcklkIHx8IG51bGw7XG4gIH1cblxuICBmb3IoY29sbGVjdGlvbikge1xuICAgIHRoaXMuY29sbGVjdGlvbiA9IGNvbGxlY3Rpb247XG4gICAgdGhpcy5jb2xsZWN0aW9uTmFtZSA9IGdldENvbGxlY3Rpb25OYW1lKGNvbGxlY3Rpb24pO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgaW5zZXJ0KGRvYywgLi4uYXJncykge1xuICAgIGlmICh0aGlzLnR5cGUpIHRocm93IG5ldyBFcnJvcihTZWN1cml0eS5lcnJvck1lc3NhZ2VzLm11bHRpcGxlQ2FuKTtcbiAgICB0aGlzLnR5cGUgPSAnaW5zZXJ0JztcbiAgICB0aGlzLmRvYyA9IGRvYztcbiAgICB0aGlzLmFyZ3MgPSBhcmdzO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgdXBkYXRlKGRvYywgbW9kaWZpZXIsIC4uLmFyZ3MpIHtcbiAgICBpZiAodGhpcy50eXBlKSB0aHJvdyBuZXcgRXJyb3IoU2VjdXJpdHkuZXJyb3JNZXNzYWdlcy5tdWx0aXBsZUNhbik7XG4gICAgdGhpcy50eXBlID0gJ3VwZGF0ZSc7XG4gICAgdGhpcy5kb2MgPSBkb2M7XG4gICAgdGhpcy5tb2RpZmllciA9IG1vZGlmaWVyO1xuICAgIHRoaXMuYXJncyA9IGFyZ3M7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICByZW1vdmUoZG9jLCAuLi5hcmdzKSB7XG4gICAgaWYgKHRoaXMudHlwZSkgdGhyb3cgbmV3IEVycm9yKFNlY3VyaXR5LmVycm9yTWVzc2FnZXMubXVsdGlwbGVDYW4pO1xuICAgIHRoaXMudHlwZSA9ICdyZW1vdmUnO1xuICAgIHRoaXMuZG9jID0gZG9jO1xuICAgIHRoaXMuYXJncyA9IGFyZ3M7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICByZWFkKGRvYywgLi4uYXJncykge1xuICAgIGlmICh0aGlzLnR5cGUpIHRocm93IG5ldyBFcnJvcihTZWN1cml0eS5lcnJvck1lc3NhZ2VzLm11bHRpcGxlQ2FuKTtcbiAgICB0aGlzLnR5cGUgPSAncmVhZCc7XG4gICAgdGhpcy5kb2MgPSBkb2M7XG4gICAgdGhpcy5hcmdzID0gYXJncztcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIGRvd25sb2FkKGRvYywgLi4uYXJncykge1xuICAgIGlmICh0aGlzLnR5cGUpIHRocm93IG5ldyBFcnJvcihTZWN1cml0eS5lcnJvck1lc3NhZ2VzLm11bHRpcGxlQ2FuKTtcbiAgICB0aGlzLnR5cGUgPSAnZG93bmxvYWQnO1xuICAgIHRoaXMuZG9jID0gZG9jO1xuICAgIHRoaXMuYXJncyA9IGFyZ3M7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyBFWEFNUExFUzpcbiAgLy8gU2VjdXJpdHkuY2FuKHVzZXJJZCkuaW5zZXJ0KGRvYykuZm9yKE15Q29sbGVjdGlvbikuY2hlY2soKVxuICAvLyBTZWN1cml0eS5jYW4odXNlcklkKS51cGRhdGUoaWQsIG1vZGlmaWVyKS5mb3IoTXlDb2xsZWN0aW9uKS5jaGVjaygpXG4gIC8vIFNlY3VyaXR5LmNhbih1c2VySWQpLnJlbW92ZShpZCkuZm9yKE15Q29sbGVjdGlvbikuY2hlY2soKVxuICBjaGVjaygpIHtcbiAgICAvLyBTZWxlY3Qgb25seSB0aG9zZSBydWxlcyB0aGF0IGFwcGx5IHRvIHRoaXMgb3BlcmF0aW9uIHR5cGVcbiAgICBjb25zdCBydWxlcyA9IGdldFJ1bGVzRm9yQ29sbGVjdGlvbkFuZFR5cGUodGhpcy5jb2xsZWN0aW9uTmFtZSwgdGhpcy50eXBlKTtcblxuICAgIC8vIElmIHRoaXMuZG9jIGlzIGFuIElELCB3ZSB3aWxsIGxvb2sgdXAgdGhlIGRvYywgZmV0Y2hpbmcgb25seSB0aGUgZmllbGRzIG5lZWRlZC5cbiAgICAvLyBUbyBmaW5kIG91dCB3aGljaCBmaWVsZHMgYXJlIG5lZWRlZCwgd2Ugd2lsbCBjb21iaW5lIGFsbCB0aGUgYGZldGNoYCBhcnJheXMgZnJvbVxuICAgIC8vIGFsbCB0aGUgcmVzdHJpY3Rpb25zIGluIGFsbCB0aGUgcnVsZXMuXG4gICAgaWYgKHR5cGVvZiB0aGlzLmRvYyA9PT0gJ3N0cmluZycgfHwgdGhpcy5kb2MgaW5zdGFuY2VvZiBNb25nb0lELk9iamVjdElEKSB7XG4gICAgICBsZXQgZmllbGRzID0ge307XG4gICAgICBfLmV2ZXJ5KHJ1bGVzLCBydWxlID0+IHtcbiAgICAgICAgY29uc3QgZmV0Y2ggPSBydWxlLmNvbWJpbmVkRmV0Y2goKTtcbiAgICAgICAgaWYgKGZldGNoID09PSBudWxsKSB7XG4gICAgICAgICAgZmllbGRzID0gbnVsbDtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7IC8vIEV4aXQgbG9vcFxuICAgICAgICB9XG4gICAgICAgIHJ1bGUuY29tYmluZWRGZXRjaCgpLmZvckVhY2goZmllbGQgPT4ge1xuICAgICAgICAgIGZpZWxkc1tmaWVsZF0gPSAxO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9KTtcblxuICAgICAgbGV0IG9wdGlvbnMgPSB7fTtcbiAgICAgIGlmIChmaWVsZHMpIHtcbiAgICAgICAgaWYgKF8uaXNFbXB0eShmaWVsZHMpKSB7XG4gICAgICAgICAgb3B0aW9ucyA9IHtfaWQ6IDF9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG9wdGlvbnMgPSB7ZmllbGRzfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5kb2MgPSB0aGlzLmNvbGxlY3Rpb24uZmluZE9uZSh0aGlzLmRvYywgb3B0aW9ucyk7XG4gICAgfVxuXG4gICAgLy8gTG9vcCB0aHJvdWdoIGFsbCBkZWZpbmVkIHJ1bGVzIGZvciB0aGlzIGNvbGxlY3Rpb24uIFRoZXJlIGlzIGFuIE9SIHJlbGF0aW9uc2hpcCBhbW9uZ1xuICAgIC8vIGFsbCBydWxlcyBmb3IgdGhlIGNvbGxlY3Rpb24sIHNvIGlmIGFueSBcImFsbG93XCIgZnVuY3Rpb24gRE8gcmV0dXJuIHRydWUsIHdlIGFsbG93LlxuICAgIHJldHVybiBfLmFueShydWxlcywgcnVsZSA9PiBydWxlLmFsbG93KHRoaXMudHlwZSwgdGhpcy5jb2xsZWN0aW9uLCB0aGlzLnVzZXJJZCwgdGhpcy5kb2MsIHRoaXMubW9kaWZpZXIsIC4uLnRoaXMuYXJncykpO1xuICB9XG5cbiAgLy8gRVhBTVBMRVM6XG4gIC8vIFNlY3VyaXR5LmNhbih1c2VySWQpLmluc2VydChkb2MpLmZvcihNeUNvbGxlY3Rpb24pLnRocm93KClcbiAgLy8gU2VjdXJpdHkuY2FuKHVzZXJJZCkudXBkYXRlKGlkLCBtb2RpZmllcikuZm9yKE15Q29sbGVjdGlvbikudGhyb3coKVxuICAvLyBTZWN1cml0eS5jYW4odXNlcklkKS5yZW1vdmUoaWQpLmZvcihNeUNvbGxlY3Rpb24pLnRocm93KClcbiAgdGhyb3coKSB7XG4gICAgaWYgKCF0aGlzLmNoZWNrKCkpIHRocm93IG5ldyBNZXRlb3IuRXJyb3IoJ2FjY2Vzcy1kZW5pZWQnLCBTZWN1cml0eS5lcnJvck1lc3NhZ2VzLm5vdEFsbG93ZWQpO1xuICB9XG59XG4iLCIvKlxuICogVGhpcyBmaWxlIGRlZmluZXMgYnVpbHQtaW4gcmVzdHJpY3Rpb24gbWV0aG9kc1xuICovXG5cbi8qXG4gKiBObyBvbmVcbiAqL1xuXG5TZWN1cml0eS5kZWZpbmVNZXRob2QoXCJuZXZlclwiLCB7XG4gIGZldGNoOiBbXSxcbiAgdHJhbnNmb3JtOiBudWxsLFxuICBhbGxvdygpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH0sXG59KTtcblxuLypcbiAqIExvZ2dlZCBJblxuICovXG5cblNlY3VyaXR5LmRlZmluZU1ldGhvZChcImlmTG9nZ2VkSW5cIiwge1xuICBmZXRjaDogW10sXG4gIHRyYW5zZm9ybTogbnVsbCxcbiAgYWxsb3codHlwZSwgYXJnLCB1c2VySWQpIHtcbiAgICByZXR1cm4gISF1c2VySWQ7XG4gIH0sXG59KTtcblxuLypcbiAqIFNwZWNpZmljIFVzZXIgSURcbiAqL1xuXG5TZWN1cml0eS5kZWZpbmVNZXRob2QoXCJpZkhhc1VzZXJJZFwiLCB7XG4gIGZldGNoOiBbXSxcbiAgdHJhbnNmb3JtOiBudWxsLFxuICBhbGxvdyh0eXBlLCBhcmcsIHVzZXJJZCkge1xuICAgIHJldHVybiB1c2VySWQgPT09IGFyZztcbiAgfSxcbn0pO1xuXG4vKlxuICogU3BlY2lmaWMgUm9sZXNcbiAqL1xuXG4vKlxuICogYWxhbm5pbmc6cm9sZXMgc3VwcG9ydFxuICovXG5pZiAoUGFja2FnZSAmJiBQYWNrYWdlW1wiYWxhbm5pbmc6cm9sZXNcIl0pIHtcblxuICB2YXIgUm9sZXMgPSBQYWNrYWdlW1wiYWxhbm5pbmc6cm9sZXNcIl0uUm9sZXM7XG5cbiAgU2VjdXJpdHkuZGVmaW5lTWV0aG9kKFwiaWZIYXNSb2xlXCIsIHtcbiAgICBmZXRjaDogW10sXG4gICAgdHJhbnNmb3JtOiBudWxsLFxuICAgIGFsbG93KHR5cGUsIGFyZywgdXNlcklkKSB7XG4gICAgICBpZiAoIWFyZykgdGhyb3cgbmV3IEVycm9yKCdpZkhhc1JvbGUgc2VjdXJpdHkgcnVsZSBtZXRob2QgcmVxdWlyZXMgYW4gYXJndW1lbnQnKTtcbiAgICAgIGlmIChhcmcucm9sZSkge1xuICAgICAgICByZXR1cm4gUm9sZXMudXNlcklzSW5Sb2xlKHVzZXJJZCwgYXJnLnJvbGUsIGFyZy5ncm91cCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gUm9sZXMudXNlcklzSW5Sb2xlKHVzZXJJZCwgYXJnKTtcbiAgICAgIH1cbiAgICB9LFxuICB9KTtcblxufVxuXG4vKlxuICogbmljb2xhc2xvcGV6ajpyb2xlcyBzdXBwb3J0XG4gKiBOb3RlOiBkb2Vzbid0IHN1cHBvcnQgZ3JvdXBzXG4gKi9cbmlmIChQYWNrYWdlICYmIFBhY2thZ2VbXCJuaWNvbGFzbG9wZXpqOnJvbGVzXCJdKSB7XG5cbiAgdmFyIFJvbGVzID0gUGFja2FnZVtcIm5pY29sYXNsb3Blemo6cm9sZXNcIl0uUm9sZXM7XG5cbiAgU2VjdXJpdHkuZGVmaW5lTWV0aG9kKFwiaWZIYXNSb2xlXCIsIHtcbiAgICBmZXRjaDogW10sXG4gICAgdHJhbnNmb3JtOiBudWxsLFxuICAgIGFsbG93KHR5cGUsIGFyZywgdXNlcklkKSB7XG4gICAgICBpZiAoIWFyZykgdGhyb3cgbmV3IEVycm9yKCdpZkhhc1JvbGUgc2VjdXJpdHkgcnVsZSBtZXRob2QgcmVxdWlyZXMgYW4gYXJndW1lbnQnKTtcbiAgICAgIHJldHVybiBSb2xlcy51c2VySGFzUm9sZSh1c2VySWQsIGFyZyk7XG4gICAgfVxuICB9KTtcblxufVxuXG4vKlxuICogU3BlY2lmaWMgUHJvcGVydGllc1xuICovXG5cblNlY3VyaXR5LmRlZmluZU1ldGhvZChcIm9ubHlQcm9wc1wiLCB7XG4gIGZldGNoOiBbXSxcbiAgdHJhbnNmb3JtOiBudWxsLFxuICBhbGxvdyh0eXBlLCBhcmcsIHVzZXJJZCwgZG9jLCBmaWVsZE5hbWVzKSB7XG4gICAgaWYgKCFfLmlzQXJyYXkoYXJnKSkgYXJnID0gW2FyZ107XG5cbiAgICBmaWVsZE5hbWVzID0gZmllbGROYW1lcyB8fCBfLmtleXMoZG9jKTtcblxuICAgIHJldHVybiBfLmV2ZXJ5KGZpZWxkTmFtZXMsIGZ1bmN0aW9uIChmaWVsZE5hbWUpIHtcbiAgICAgIHJldHVybiBfLmNvbnRhaW5zKGFyZywgZmllbGROYW1lKTtcbiAgICB9KTtcbiAgfSxcbn0pO1xuXG5TZWN1cml0eS5kZWZpbmVNZXRob2QoXCJleGNlcHRQcm9wc1wiLCB7XG4gIGZldGNoOiBbXSxcbiAgdHJhbnNmb3JtOiBudWxsLFxuICBhbGxvdyh0eXBlLCBhcmcsIHVzZXJJZCwgZG9jLCBmaWVsZE5hbWVzKSB7XG4gICAgaWYgKCFfLmlzQXJyYXkoYXJnKSkgYXJnID0gW2FyZ107XG5cbiAgICBmaWVsZE5hbWVzID0gZmllbGROYW1lcyB8fCBfLmtleXMoZG9jKTtcblxuICAgIHJldHVybiAhXy5hbnkoZmllbGROYW1lcywgZnVuY3Rpb24gKGZpZWxkTmFtZSkge1xuICAgICAgcmV0dXJuIF8uY29udGFpbnMoYXJnLCBmaWVsZE5hbWUpO1xuICAgIH0pO1xuICB9LFxufSk7XG4iXX0=
