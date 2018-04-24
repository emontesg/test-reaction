(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var NpmModuleMongodb = Package['npm-mongo'].NpmModuleMongodb;
var NpmModuleMongodbVersion = Package['npm-mongo'].NpmModuleMongodbVersion;
var AllowDeny = Package['allow-deny'].AllowDeny;
var Random = Package.random.Random;
var EJSON = Package.ejson.EJSON;
var LocalCollection = Package.minimongo.LocalCollection;
var Minimongo = Package.minimongo.Minimongo;
var DDP = Package['ddp-client'].DDP;
var DDPServer = Package['ddp-server'].DDPServer;
var Tracker = Package.tracker.Tracker;
var Deps = Package.tracker.Deps;
var DiffSequence = Package['diff-sequence'].DiffSequence;
var MongoID = Package['mongo-id'].MongoID;
var check = Package.check.check;
var Match = Package.check.Match;
var ECMAScript = Package.ecmascript.ECMAScript;
var _ = Package.underscore._;
var MaxHeap = Package['binary-heap'].MaxHeap;
var MinHeap = Package['binary-heap'].MinHeap;
var MinMaxHeap = Package['binary-heap'].MinMaxHeap;
var Hook = Package['callback-hook'].Hook;
var meteorInstall = Package.modules.meteorInstall;
var meteorBabelHelpers = Package['babel-runtime'].meteorBabelHelpers;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var MongoInternals, MongoTest, MongoConnection, CursorDescription, Cursor, listenAll, forEachTrigger, OPLOG_COLLECTION, idForOp, OplogHandle, ObserveMultiplexer, ObserveHandle, DocFetcher, PollingObserveDriver, OplogObserveDriver, Mongo, selector, callback, options;

var require = meteorInstall({"node_modules":{"meteor":{"mongo":{"mongo_driver.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/mongo_driver.js                                                                                      //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
/**
 * Provide a synchronous Collection API using fibers, backed by
 * MongoDB.  This is only for use on the server, and mostly identical
 * to the client API.
 *
 * NOTE: the public API methods must be run within a fiber. If you call
 * these outside of a fiber they will explode!
 */
var MongoDB = NpmModuleMongodb;

var Future = Npm.require('fibers/future');

MongoInternals = {};
MongoTest = {};
MongoInternals.NpmModules = {
  mongodb: {
    version: NpmModuleMongodbVersion,
    module: MongoDB
  }
}; // Older version of what is now available via
// MongoInternals.NpmModules.mongodb.module.  It was never documented, but
// people do use it.
// XXX COMPAT WITH 1.0.3.2

MongoInternals.NpmModule = MongoDB; // This is used to add or remove EJSON from the beginning of everything nested
// inside an EJSON custom type. It should only be called on pure JSON!

var replaceNames = function (filter, thing) {
  if (typeof thing === "object") {
    if (_.isArray(thing)) {
      return _.map(thing, _.bind(replaceNames, null, filter));
    }

    var ret = {};

    _.each(thing, function (value, key) {
      ret[filter(key)] = replaceNames(filter, value);
    });

    return ret;
  }

  return thing;
}; // Ensure that EJSON.clone keeps a Timestamp as a Timestamp (instead of just
// doing a structural clone).
// XXX how ok is this? what if there are multiple copies of MongoDB loaded?


MongoDB.Timestamp.prototype.clone = function () {
  // Timestamps should be immutable.
  return this;
};

var makeMongoLegal = function (name) {
  return "EJSON" + name;
};

var unmakeMongoLegal = function (name) {
  return name.substr(5);
};

var replaceMongoAtomWithMeteor = function (document) {
  if (document instanceof MongoDB.Binary) {
    var buffer = document.value(true);
    return new Uint8Array(buffer);
  }

  if (document instanceof MongoDB.ObjectID) {
    return new Mongo.ObjectID(document.toHexString());
  }

  if (document["EJSON$type"] && document["EJSON$value"] && _.size(document) === 2) {
    return EJSON.fromJSONValue(replaceNames(unmakeMongoLegal, document));
  }

  if (document instanceof MongoDB.Timestamp) {
    // For now, the Meteor representation of a Mongo timestamp type (not a date!
    // this is a weird internal thing used in the oplog!) is the same as the
    // Mongo representation. We need to do this explicitly or else we would do a
    // structural clone and lose the prototype.
    return document;
  }

  return undefined;
};

var replaceMeteorAtomWithMongo = function (document) {
  if (EJSON.isBinary(document)) {
    // This does more copies than we'd like, but is necessary because
    // MongoDB.BSON only looks like it takes a Uint8Array (and doesn't actually
    // serialize it correctly).
    return new MongoDB.Binary(Buffer.from(document));
  }

  if (document instanceof Mongo.ObjectID) {
    return new MongoDB.ObjectID(document.toHexString());
  }

  if (document instanceof MongoDB.Timestamp) {
    // For now, the Meteor representation of a Mongo timestamp type (not a date!
    // this is a weird internal thing used in the oplog!) is the same as the
    // Mongo representation. We need to do this explicitly or else we would do a
    // structural clone and lose the prototype.
    return document;
  }

  if (EJSON._isCustomType(document)) {
    return replaceNames(makeMongoLegal, EJSON.toJSONValue(document));
  } // It is not ordinarily possible to stick dollar-sign keys into mongo
  // so we don't bother checking for things that need escaping at this time.


  return undefined;
};

var replaceTypes = function (document, atomTransformer) {
  if (typeof document !== 'object' || document === null) return document;
  var replacedTopLevelAtom = atomTransformer(document);
  if (replacedTopLevelAtom !== undefined) return replacedTopLevelAtom;
  var ret = document;

  _.each(document, function (val, key) {
    var valReplaced = replaceTypes(val, atomTransformer);

    if (val !== valReplaced) {
      // Lazy clone. Shallow copy.
      if (ret === document) ret = _.clone(document);
      ret[key] = valReplaced;
    }
  });

  return ret;
};

MongoConnection = function (url, options) {
  var self = this;
  options = options || {};
  self._observeMultiplexers = {};
  self._onFailoverHook = new Hook();
  var mongoOptions = Object.assign({
    // Reconnect on error.
    autoReconnect: true,
    // Try to reconnect forever, instead of stopping after 30 tries (the
    // default), with each attempt separated by 1000ms.
    reconnectTries: Infinity,
    ignoreUndefined: true
  }, Mongo._connectionOptions); // Disable the native parser by default, unless specifically enabled
  // in the mongo URL.
  // - The native driver can cause errors which normally would be
  //   thrown, caught, and handled into segfaults that take down the
  //   whole app.
  // - Binary modules don't yet work when you bundle and move the bundle
  //   to a different platform (aka deploy)
  // We should revisit this after binary npm module support lands.

  if (!/[\?&]native_?[pP]arser=/.test(url)) {
    mongoOptions.native_parser = false;
  } // Internally the oplog connections specify their own poolSize
  // which we don't want to overwrite with any user defined value


  if (_.has(options, 'poolSize')) {
    // If we just set this for "server", replSet will override it. If we just
    // set it for replSet, it will be ignored if we're not using a replSet.
    mongoOptions.poolSize = options.poolSize;
  }

  self.db = null; // We keep track of the ReplSet's primary, so that we can trigger hooks when
  // it changes.  The Node driver's joined callback seems to fire way too
  // often, which is why we need to track it ourselves.

  self._primary = null;
  self._oplogHandle = null;
  self._docFetcher = null;
  var connectFuture = new Future();
  MongoDB.connect(url, mongoOptions, Meteor.bindEnvironment(function (err, db) {
    if (err) {
      throw err;
    } // First, figure out what the current primary is, if any.


    if (db.serverConfig.isMasterDoc) {
      self._primary = db.serverConfig.isMasterDoc.primary;
    }

    db.serverConfig.on('joined', Meteor.bindEnvironment(function (kind, doc) {
      if (kind === 'primary') {
        if (doc.primary !== self._primary) {
          self._primary = doc.primary;

          self._onFailoverHook.each(function (callback) {
            callback();
            return true;
          });
        }
      } else if (doc.me === self._primary) {
        // The thing we thought was primary is now something other than
        // primary.  Forget that we thought it was primary.  (This means
        // that if a server stops being primary and then starts being
        // primary again without another server becoming primary in the
        // middle, we'll correctly count it as a failover.)
        self._primary = null;
      }
    })); // Allow the constructor to return.

    connectFuture['return'](db);
  }, connectFuture.resolver() // onException
  )); // Wait for the connection to be successful; throws on failure.

  self.db = connectFuture.wait();

  if (options.oplogUrl && !Package['disable-oplog']) {
    self._oplogHandle = new OplogHandle(options.oplogUrl, self.db.databaseName);
    self._docFetcher = new DocFetcher(self);
  }
};

MongoConnection.prototype.close = function () {
  var self = this;
  if (!self.db) throw Error("close called before Connection created?"); // XXX probably untested

  var oplogHandle = self._oplogHandle;
  self._oplogHandle = null;
  if (oplogHandle) oplogHandle.stop(); // Use Future.wrap so that errors get thrown. This happens to
  // work even outside a fiber since the 'close' method is not
  // actually asynchronous.

  Future.wrap(_.bind(self.db.close, self.db))(true).wait();
}; // Returns the Mongo Collection object; may yield.


MongoConnection.prototype.rawCollection = function (collectionName) {
  var self = this;
  if (!self.db) throw Error("rawCollection called before Connection created?");
  var future = new Future();
  self.db.collection(collectionName, future.resolver());
  return future.wait();
};

MongoConnection.prototype._createCappedCollection = function (collectionName, byteSize, maxDocuments) {
  var self = this;
  if (!self.db) throw Error("_createCappedCollection called before Connection created?");
  var future = new Future();
  self.db.createCollection(collectionName, {
    capped: true,
    size: byteSize,
    max: maxDocuments
  }, future.resolver());
  future.wait();
}; // This should be called synchronously with a write, to create a
// transaction on the current write fence, if any. After we can read
// the write, and after observers have been notified (or at least,
// after the observer notifiers have added themselves to the write
// fence), you should call 'committed()' on the object returned.


MongoConnection.prototype._maybeBeginWrite = function () {
  var fence = DDPServer._CurrentWriteFence.get();

  if (fence) {
    return fence.beginWrite();
  } else {
    return {
      committed: function () {}
    };
  }
}; // Internal interface: adds a callback which is called when the Mongo primary
// changes. Returns a stop handle.


MongoConnection.prototype._onFailover = function (callback) {
  return this._onFailoverHook.register(callback);
}; //////////// Public API //////////
// The write methods block until the database has confirmed the write (it may
// not be replicated or stable on disk, but one server has confirmed it) if no
// callback is provided. If a callback is provided, then they call the callback
// when the write is confirmed. They return nothing on success, and raise an
// exception on failure.
//
// After making a write (with insert, update, remove), observers are
// notified asynchronously. If you want to receive a callback once all
// of the observer notifications have landed for your write, do the
// writes inside a write fence (set DDPServer._CurrentWriteFence to a new
// _WriteFence, and then set a callback on the write fence.)
//
// Since our execution environment is single-threaded, this is
// well-defined -- a write "has been made" if it's returned, and an
// observer "has been notified" if its callback has returned.


var writeCallback = function (write, refresh, callback) {
  return function (err, result) {
    if (!err) {
      // XXX We don't have to run this on error, right?
      try {
        refresh();
      } catch (refreshErr) {
        if (callback) {
          callback(refreshErr);
          return;
        } else {
          throw refreshErr;
        }
      }
    }

    write.committed();

    if (callback) {
      callback(err, result);
    } else if (err) {
      throw err;
    }
  };
};

var bindEnvironmentForWrite = function (callback) {
  return Meteor.bindEnvironment(callback, "Mongo write");
};

MongoConnection.prototype._insert = function (collection_name, document, callback) {
  var self = this;

  var sendError = function (e) {
    if (callback) return callback(e);
    throw e;
  };

  if (collection_name === "___meteor_failure_test_collection") {
    var e = new Error("Failure test");
    e._expectedByTest = true;
    sendError(e);
    return;
  }

  if (!(LocalCollection._isPlainObject(document) && !EJSON._isCustomType(document))) {
    sendError(new Error("Only plain objects may be inserted into MongoDB"));
    return;
  }

  var write = self._maybeBeginWrite();

  var refresh = function () {
    Meteor.refresh({
      collection: collection_name,
      id: document._id
    });
  };

  callback = bindEnvironmentForWrite(writeCallback(write, refresh, callback));

  try {
    var collection = self.rawCollection(collection_name);
    collection.insert(replaceTypes(document, replaceMeteorAtomWithMongo), {
      safe: true
    }, callback);
  } catch (err) {
    write.committed();
    throw err;
  }
}; // Cause queries that may be affected by the selector to poll in this write
// fence.


MongoConnection.prototype._refresh = function (collectionName, selector) {
  var refreshKey = {
    collection: collectionName
  }; // If we know which documents we're removing, don't poll queries that are
  // specific to other documents. (Note that multiple notifications here should
  // not cause multiple polls, since all our listener is doing is enqueueing a
  // poll.)

  var specificIds = LocalCollection._idsMatchedBySelector(selector);

  if (specificIds) {
    _.each(specificIds, function (id) {
      Meteor.refresh(_.extend({
        id: id
      }, refreshKey));
    });
  } else {
    Meteor.refresh(refreshKey);
  }
};

MongoConnection.prototype._remove = function (collection_name, selector, callback) {
  var self = this;

  if (collection_name === "___meteor_failure_test_collection") {
    var e = new Error("Failure test");
    e._expectedByTest = true;

    if (callback) {
      return callback(e);
    } else {
      throw e;
    }
  }

  var write = self._maybeBeginWrite();

  var refresh = function () {
    self._refresh(collection_name, selector);
  };

  callback = bindEnvironmentForWrite(writeCallback(write, refresh, callback));

  try {
    var collection = self.rawCollection(collection_name);

    var wrappedCallback = function (err, driverResult) {
      callback(err, transformResult(driverResult).numberAffected);
    };

    collection.remove(replaceTypes(selector, replaceMeteorAtomWithMongo), {
      safe: true
    }, wrappedCallback);
  } catch (err) {
    write.committed();
    throw err;
  }
};

MongoConnection.prototype._dropCollection = function (collectionName, cb) {
  var self = this;

  var write = self._maybeBeginWrite();

  var refresh = function () {
    Meteor.refresh({
      collection: collectionName,
      id: null,
      dropCollection: true
    });
  };

  cb = bindEnvironmentForWrite(writeCallback(write, refresh, cb));

  try {
    var collection = self.rawCollection(collectionName);
    collection.drop(cb);
  } catch (e) {
    write.committed();
    throw e;
  }
}; // For testing only.  Slightly better than `c.rawDatabase().dropDatabase()`
// because it lets the test's fence wait for it to be complete.


MongoConnection.prototype._dropDatabase = function (cb) {
  var self = this;

  var write = self._maybeBeginWrite();

  var refresh = function () {
    Meteor.refresh({
      dropDatabase: true
    });
  };

  cb = bindEnvironmentForWrite(writeCallback(write, refresh, cb));

  try {
    self.db.dropDatabase(cb);
  } catch (e) {
    write.committed();
    throw e;
  }
};

MongoConnection.prototype._update = function (collection_name, selector, mod, options, callback) {
  var self = this;

  if (!callback && options instanceof Function) {
    callback = options;
    options = null;
  }

  if (collection_name === "___meteor_failure_test_collection") {
    var e = new Error("Failure test");
    e._expectedByTest = true;

    if (callback) {
      return callback(e);
    } else {
      throw e;
    }
  } // explicit safety check. null and undefined can crash the mongo
  // driver. Although the node driver and minimongo do 'support'
  // non-object modifier in that they don't crash, they are not
  // meaningful operations and do not do anything. Defensively throw an
  // error here.


  if (!mod || typeof mod !== 'object') throw new Error("Invalid modifier. Modifier must be an object.");

  if (!(LocalCollection._isPlainObject(mod) && !EJSON._isCustomType(mod))) {
    throw new Error("Only plain objects may be used as replacement" + " documents in MongoDB");
  }

  if (!options) options = {};

  var write = self._maybeBeginWrite();

  var refresh = function () {
    self._refresh(collection_name, selector);
  };

  callback = writeCallback(write, refresh, callback);

  try {
    var collection = self.rawCollection(collection_name);
    var mongoOpts = {
      safe: true
    }; // explictly enumerate options that minimongo supports

    if (options.upsert) mongoOpts.upsert = true;
    if (options.multi) mongoOpts.multi = true; // Lets you get a more more full result from MongoDB. Use with caution:
    // might not work with C.upsert (as opposed to C.update({upsert:true}) or
    // with simulated upsert.

    if (options.fullResult) mongoOpts.fullResult = true;
    var mongoSelector = replaceTypes(selector, replaceMeteorAtomWithMongo);
    var mongoMod = replaceTypes(mod, replaceMeteorAtomWithMongo);

    var isModify = LocalCollection._isModificationMod(mongoMod);

    if (options._forbidReplace && !isModify) {
      var err = new Error("Invalid modifier. Replacements are forbidden.");

      if (callback) {
        return callback(err);
      } else {
        throw err;
      }
    } // We've already run replaceTypes/replaceMeteorAtomWithMongo on
    // selector and mod.  We assume it doesn't matter, as far as
    // the behavior of modifiers is concerned, whether `_modify`
    // is run on EJSON or on mongo-converted EJSON.
    // Run this code up front so that it fails fast if someone uses
    // a Mongo update operator we don't support.


    let knownId;

    if (options.upsert) {
      try {
        let newDoc = LocalCollection._createUpsertDocument(selector, mod);

        knownId = newDoc._id;
      } catch (err) {
        if (callback) {
          return callback(err);
        } else {
          throw err;
        }
      }
    }

    if (options.upsert && !isModify && !knownId && options.insertedId && !(options.insertedId instanceof Mongo.ObjectID && options.generatedId)) {
      // In case of an upsert with a replacement, where there is no _id defined
      // in either the query or the replacement doc, mongo will generate an id itself.
      // Therefore we need this special strategy if we want to control the id ourselves.
      // We don't need to do this when:
      // - This is not a replacement, so we can add an _id to $setOnInsert
      // - The id is defined by query or mod we can just add it to the replacement doc
      // - The user did not specify any id preference and the id is a Mongo ObjectId,
      //     then we can just let Mongo generate the id
      simulateUpsertWithInsertedId(collection, mongoSelector, mongoMod, options, // This callback does not need to be bindEnvironment'ed because
      // simulateUpsertWithInsertedId() wraps it and then passes it through
      // bindEnvironmentForWrite.
      function (error, result) {
        // If we got here via a upsert() call, then options._returnObject will
        // be set and we should return the whole object. Otherwise, we should
        // just return the number of affected docs to match the mongo API.
        if (result && !options._returnObject) {
          callback(error, result.numberAffected);
        } else {
          callback(error, result);
        }
      });
    } else {
      if (options.upsert && !knownId && options.insertedId && isModify) {
        if (!mongoMod.hasOwnProperty('$setOnInsert')) {
          mongoMod.$setOnInsert = {};
        }

        knownId = options.insertedId;
        Object.assign(mongoMod.$setOnInsert, replaceTypes({
          _id: options.insertedId
        }, replaceMeteorAtomWithMongo));
      }

      collection.update(mongoSelector, mongoMod, mongoOpts, bindEnvironmentForWrite(function (err, result) {
        if (!err) {
          var meteorResult = transformResult(result);

          if (meteorResult && options._returnObject) {
            // If this was an upsert() call, and we ended up
            // inserting a new doc and we know its id, then
            // return that id as well.
            if (options.upsert && meteorResult.insertedId) {
              if (knownId) {
                meteorResult.insertedId = knownId;
              } else if (meteorResult.insertedId instanceof MongoDB.ObjectID) {
                meteorResult.insertedId = new Mongo.ObjectID(meteorResult.insertedId.toHexString());
              }
            }

            callback(err, meteorResult);
          } else {
            callback(err, meteorResult.numberAffected);
          }
        } else {
          callback(err);
        }
      }));
    }
  } catch (e) {
    write.committed();
    throw e;
  }
};

var transformResult = function (driverResult) {
  var meteorResult = {
    numberAffected: 0
  };

  if (driverResult) {
    var mongoResult = driverResult.result; // On updates with upsert:true, the inserted values come as a list of
    // upserted values -- even with options.multi, when the upsert does insert,
    // it only inserts one element.

    if (mongoResult.upserted) {
      meteorResult.numberAffected += mongoResult.upserted.length;

      if (mongoResult.upserted.length == 1) {
        meteorResult.insertedId = mongoResult.upserted[0]._id;
      }
    } else {
      meteorResult.numberAffected = mongoResult.n;
    }
  }

  return meteorResult;
};

var NUM_OPTIMISTIC_TRIES = 3; // exposed for testing

MongoConnection._isCannotChangeIdError = function (err) {
  // Mongo 3.2.* returns error as next Object:
  // {name: String, code: Number, errmsg: String}
  // Older Mongo returns:
  // {name: String, code: Number, err: String}
  var error = err.errmsg || err.err; // We don't use the error code here
  // because the error code we observed it producing (16837) appears to be
  // a far more generic error code based on examining the source.

  if (error.indexOf('The _id field cannot be changed') === 0 || error.indexOf("the (immutable) field '_id' was found to have been altered to _id") !== -1) {
    return true;
  }

  return false;
};

var simulateUpsertWithInsertedId = function (collection, selector, mod, options, callback) {
  // STRATEGY: First try doing an upsert with a generated ID.
  // If this throws an error about changing the ID on an existing document
  // then without affecting the database, we know we should probably try
  // an update without the generated ID. If it affected 0 documents,
  // then without affecting the database, we the document that first
  // gave the error is probably removed and we need to try an insert again
  // We go back to step one and repeat.
  // Like all "optimistic write" schemes, we rely on the fact that it's
  // unlikely our writes will continue to be interfered with under normal
  // circumstances (though sufficiently heavy contention with writers
  // disagreeing on the existence of an object will cause writes to fail
  // in theory).
  var insertedId = options.insertedId; // must exist

  var mongoOptsForUpdate = {
    safe: true,
    multi: options.multi
  };
  var mongoOptsForInsert = {
    safe: true,
    upsert: true
  };
  var replacementWithId = Object.assign(replaceTypes({
    _id: insertedId
  }, replaceMeteorAtomWithMongo), mod);
  var tries = NUM_OPTIMISTIC_TRIES;

  var doUpdate = function () {
    tries--;

    if (!tries) {
      callback(new Error("Upsert failed after " + NUM_OPTIMISTIC_TRIES + " tries."));
    } else {
      collection.update(selector, mod, mongoOptsForUpdate, bindEnvironmentForWrite(function (err, result) {
        if (err) {
          callback(err);
        } else if (result && result.result.n != 0) {
          callback(null, {
            numberAffected: result.result.n
          });
        } else {
          doConditionalInsert();
        }
      }));
    }
  };

  var doConditionalInsert = function () {
    collection.update(selector, replacementWithId, mongoOptsForInsert, bindEnvironmentForWrite(function (err, result) {
      if (err) {
        // figure out if this is a
        // "cannot change _id of document" error, and
        // if so, try doUpdate() again, up to 3 times.
        if (MongoConnection._isCannotChangeIdError(err)) {
          doUpdate();
        } else {
          callback(err);
        }
      } else {
        callback(null, {
          numberAffected: result.result.upserted.length,
          insertedId: insertedId
        });
      }
    }));
  };

  doUpdate();
};

_.each(["insert", "update", "remove", "dropCollection", "dropDatabase"], function (method) {
  MongoConnection.prototype[method] = function ()
  /* arguments */
  {
    var self = this;
    return Meteor.wrapAsync(self["_" + method]).apply(self, arguments);
  };
}); // XXX MongoConnection.upsert() does not return the id of the inserted document
// unless you set it explicitly in the selector or modifier (as a replacement
// doc).


MongoConnection.prototype.upsert = function (collectionName, selector, mod, options, callback) {
  var self = this;

  if (typeof options === "function" && !callback) {
    callback = options;
    options = {};
  }

  return self.update(collectionName, selector, mod, _.extend({}, options, {
    upsert: true,
    _returnObject: true
  }), callback);
};

MongoConnection.prototype.find = function (collectionName, selector, options) {
  var self = this;
  if (arguments.length === 1) selector = {};
  return new Cursor(self, new CursorDescription(collectionName, selector, options));
};

MongoConnection.prototype.findOne = function (collection_name, selector, options) {
  var self = this;
  if (arguments.length === 1) selector = {};
  options = options || {};
  options.limit = 1;
  return self.find(collection_name, selector, options).fetch()[0];
}; // We'll actually design an index API later. For now, we just pass through to
// Mongo's, but make it synchronous.


MongoConnection.prototype._ensureIndex = function (collectionName, index, options) {
  var self = this; // We expect this function to be called at startup, not from within a method,
  // so we don't interact with the write fence.

  var collection = self.rawCollection(collectionName);
  var future = new Future();
  var indexName = collection.ensureIndex(index, options, future.resolver());
  future.wait();
};

MongoConnection.prototype._dropIndex = function (collectionName, index) {
  var self = this; // This function is only used by test code, not within a method, so we don't
  // interact with the write fence.

  var collection = self.rawCollection(collectionName);
  var future = new Future();
  var indexName = collection.dropIndex(index, future.resolver());
  future.wait();
}; // CURSORS
// There are several classes which relate to cursors:
//
// CursorDescription represents the arguments used to construct a cursor:
// collectionName, selector, and (find) options.  Because it is used as a key
// for cursor de-dup, everything in it should either be JSON-stringifiable or
// not affect observeChanges output (eg, options.transform functions are not
// stringifiable but do not affect observeChanges).
//
// SynchronousCursor is a wrapper around a MongoDB cursor
// which includes fully-synchronous versions of forEach, etc.
//
// Cursor is the cursor object returned from find(), which implements the
// documented Mongo.Collection cursor API.  It wraps a CursorDescription and a
// SynchronousCursor (lazily: it doesn't contact Mongo until you call a method
// like fetch or forEach on it).
//
// ObserveHandle is the "observe handle" returned from observeChanges. It has a
// reference to an ObserveMultiplexer.
//
// ObserveMultiplexer allows multiple identical ObserveHandles to be driven by a
// single observe driver.
//
// There are two "observe drivers" which drive ObserveMultiplexers:
//   - PollingObserveDriver caches the results of a query and reruns it when
//     necessary.
//   - OplogObserveDriver follows the Mongo operation log to directly observe
//     database changes.
// Both implementations follow the same simple interface: when you create them,
// they start sending observeChanges callbacks (and a ready() invocation) to
// their ObserveMultiplexer, and you stop them by calling their stop() method.


CursorDescription = function (collectionName, selector, options) {
  var self = this;
  self.collectionName = collectionName;
  self.selector = Mongo.Collection._rewriteSelector(selector);
  self.options = options || {};
};

Cursor = function (mongo, cursorDescription) {
  var self = this;
  self._mongo = mongo;
  self._cursorDescription = cursorDescription;
  self._synchronousCursor = null;
};

_.each(['forEach', 'map', 'fetch', 'count'], function (method) {
  Cursor.prototype[method] = function () {
    var self = this; // You can only observe a tailable cursor.

    if (self._cursorDescription.options.tailable) throw new Error("Cannot call " + method + " on a tailable cursor");

    if (!self._synchronousCursor) {
      self._synchronousCursor = self._mongo._createSynchronousCursor(self._cursorDescription, {
        // Make sure that the "self" argument to forEach/map callbacks is the
        // Cursor, not the SynchronousCursor.
        selfForIteration: self,
        useTransform: true
      });
    }

    return self._synchronousCursor[method].apply(self._synchronousCursor, arguments);
  };
}); // Since we don't actually have a "nextObject" interface, there's really no
// reason to have a "rewind" interface.  All it did was make multiple calls
// to fetch/map/forEach return nothing the second time.
// XXX COMPAT WITH 0.8.1


Cursor.prototype.rewind = function () {};

Cursor.prototype.getTransform = function () {
  return this._cursorDescription.options.transform;
}; // When you call Meteor.publish() with a function that returns a Cursor, we need
// to transmute it into the equivalent subscription.  This is the function that
// does that.


Cursor.prototype._publishCursor = function (sub) {
  var self = this;
  var collection = self._cursorDescription.collectionName;
  return Mongo.Collection._publishCursor(self, sub, collection);
}; // Used to guarantee that publish functions return at most one cursor per
// collection. Private, because we might later have cursors that include
// documents from multiple collections somehow.


Cursor.prototype._getCollectionName = function () {
  var self = this;
  return self._cursorDescription.collectionName;
};

Cursor.prototype.observe = function (callbacks) {
  var self = this;
  return LocalCollection._observeFromObserveChanges(self, callbacks);
};

Cursor.prototype.observeChanges = function (callbacks) {
  var self = this;
  var methods = ['addedAt', 'added', 'changedAt', 'changed', 'removedAt', 'removed', 'movedTo'];

  var ordered = LocalCollection._observeChangesCallbacksAreOrdered(callbacks); // XXX: Can we find out if callbacks are from observe?


  var exceptionName = ' observe/observeChanges callback';
  methods.forEach(function (method) {
    if (callbacks[method] && typeof callbacks[method] == "function") {
      callbacks[method] = Meteor.bindEnvironment(callbacks[method], method + exceptionName);
    }
  });
  return self._mongo._observeChanges(self._cursorDescription, ordered, callbacks);
};

MongoConnection.prototype._createSynchronousCursor = function (cursorDescription, options) {
  var self = this;
  options = _.pick(options || {}, 'selfForIteration', 'useTransform');
  var collection = self.rawCollection(cursorDescription.collectionName);
  var cursorOptions = cursorDescription.options;
  var mongoOptions = {
    sort: cursorOptions.sort,
    limit: cursorOptions.limit,
    skip: cursorOptions.skip
  }; // Do we want a tailable cursor (which only works on capped collections)?

  if (cursorOptions.tailable) {
    // We want a tailable cursor...
    mongoOptions.tailable = true; // ... and for the server to wait a bit if any getMore has no data (rather
    // than making us put the relevant sleeps in the client)...

    mongoOptions.awaitdata = true; // ... and to keep querying the server indefinitely rather than just 5 times
    // if there's no more data.

    mongoOptions.numberOfRetries = -1; // And if this is on the oplog collection and the cursor specifies a 'ts',
    // then set the undocumented oplog replay flag, which does a special scan to
    // find the first document (instead of creating an index on ts). This is a
    // very hard-coded Mongo flag which only works on the oplog collection and
    // only works with the ts field.

    if (cursorDescription.collectionName === OPLOG_COLLECTION && cursorDescription.selector.ts) {
      mongoOptions.oplogReplay = true;
    }
  }

  var dbCursor = collection.find(replaceTypes(cursorDescription.selector, replaceMeteorAtomWithMongo), cursorOptions.fields, mongoOptions);

  if (typeof cursorOptions.maxTimeMs !== 'undefined') {
    dbCursor = dbCursor.maxTimeMS(cursorOptions.maxTimeMs);
  }

  if (typeof cursorOptions.hint !== 'undefined') {
    dbCursor = dbCursor.hint(cursorOptions.hint);
  }

  return new SynchronousCursor(dbCursor, cursorDescription, options);
};

var SynchronousCursor = function (dbCursor, cursorDescription, options) {
  var self = this;
  options = _.pick(options || {}, 'selfForIteration', 'useTransform');
  self._dbCursor = dbCursor;
  self._cursorDescription = cursorDescription; // The "self" argument passed to forEach/map callbacks. If we're wrapped
  // inside a user-visible Cursor, we want to provide the outer cursor!

  self._selfForIteration = options.selfForIteration || self;

  if (options.useTransform && cursorDescription.options.transform) {
    self._transform = LocalCollection.wrapTransform(cursorDescription.options.transform);
  } else {
    self._transform = null;
  } // Need to specify that the callback is the first argument to nextObject,
  // since otherwise when we try to call it with no args the driver will
  // interpret "undefined" first arg as an options hash and crash.


  self._synchronousNextObject = Future.wrap(dbCursor.nextObject.bind(dbCursor), 0);
  self._synchronousCount = Future.wrap(dbCursor.count.bind(dbCursor));
  self._visitedIds = new LocalCollection._IdMap();
};

_.extend(SynchronousCursor.prototype, {
  _nextObject: function () {
    var self = this;

    while (true) {
      var doc = self._synchronousNextObject().wait();

      if (!doc) return null;
      doc = replaceTypes(doc, replaceMongoAtomWithMeteor);

      if (!self._cursorDescription.options.tailable && _.has(doc, '_id')) {
        // Did Mongo give us duplicate documents in the same cursor? If so,
        // ignore this one. (Do this before the transform, since transform might
        // return some unrelated value.) We don't do this for tailable cursors,
        // because we want to maintain O(1) memory usage. And if there isn't _id
        // for some reason (maybe it's the oplog), then we don't do this either.
        // (Be careful to do this for falsey but existing _id, though.)
        if (self._visitedIds.has(doc._id)) continue;

        self._visitedIds.set(doc._id, true);
      }

      if (self._transform) doc = self._transform(doc);
      return doc;
    }
  },
  forEach: function (callback, thisArg) {
    var self = this; // Get back to the beginning.

    self._rewind(); // We implement the loop ourself instead of using self._dbCursor.each,
    // because "each" will call its callback outside of a fiber which makes it
    // much more complex to make this function synchronous.


    var index = 0;

    while (true) {
      var doc = self._nextObject();

      if (!doc) return;
      callback.call(thisArg, doc, index++, self._selfForIteration);
    }
  },
  // XXX Allow overlapping callback executions if callback yields.
  map: function (callback, thisArg) {
    var self = this;
    var res = [];
    self.forEach(function (doc, index) {
      res.push(callback.call(thisArg, doc, index, self._selfForIteration));
    });
    return res;
  },
  _rewind: function () {
    var self = this; // known to be synchronous

    self._dbCursor.rewind();

    self._visitedIds = new LocalCollection._IdMap();
  },
  // Mostly usable for tailable cursors.
  close: function () {
    var self = this;

    self._dbCursor.close();
  },
  fetch: function () {
    var self = this;
    return self.map(_.identity);
  },
  count: function (applySkipLimit = false) {
    var self = this;
    return self._synchronousCount(applySkipLimit).wait();
  },
  // This method is NOT wrapped in Cursor.
  getRawObjects: function (ordered) {
    var self = this;

    if (ordered) {
      return self.fetch();
    } else {
      var results = new LocalCollection._IdMap();
      self.forEach(function (doc) {
        results.set(doc._id, doc);
      });
      return results;
    }
  }
});

MongoConnection.prototype.tail = function (cursorDescription, docCallback) {
  var self = this;
  if (!cursorDescription.options.tailable) throw new Error("Can only tail a tailable cursor");

  var cursor = self._createSynchronousCursor(cursorDescription);

  var stopped = false;
  var lastTS;

  var loop = function () {
    var doc = null;

    while (true) {
      if (stopped) return;

      try {
        doc = cursor._nextObject();
      } catch (err) {
        // There's no good way to figure out if this was actually an error
        // from Mongo. Ah well. But either way, we need to retry the cursor
        // (unless the failure was because the observe got stopped).
        doc = null;
      } // Since cursor._nextObject can yield, we need to check again to see if
      // we've been stopped before calling the callback.


      if (stopped) return;

      if (doc) {
        // If a tailable cursor contains a "ts" field, use it to recreate the
        // cursor on error. ("ts" is a standard that Mongo uses internally for
        // the oplog, and there's a special flag that lets you do binary search
        // on it instead of needing to use an index.)
        lastTS = doc.ts;
        docCallback(doc);
      } else {
        var newSelector = _.clone(cursorDescription.selector);

        if (lastTS) {
          newSelector.ts = {
            $gt: lastTS
          };
        }

        cursor = self._createSynchronousCursor(new CursorDescription(cursorDescription.collectionName, newSelector, cursorDescription.options)); // Mongo failover takes many seconds.  Retry in a bit.  (Without this
        // setTimeout, we peg the CPU at 100% and never notice the actual
        // failover.

        Meteor.setTimeout(loop, 100);
        break;
      }
    }
  };

  Meteor.defer(loop);
  return {
    stop: function () {
      stopped = true;
      cursor.close();
    }
  };
};

MongoConnection.prototype._observeChanges = function (cursorDescription, ordered, callbacks) {
  var self = this;

  if (cursorDescription.options.tailable) {
    return self._observeChangesTailable(cursorDescription, ordered, callbacks);
  } // You may not filter out _id when observing changes, because the id is a core
  // part of the observeChanges API.


  if (cursorDescription.options.fields && (cursorDescription.options.fields._id === 0 || cursorDescription.options.fields._id === false)) {
    throw Error("You may not observe a cursor with {fields: {_id: 0}}");
  }

  var observeKey = EJSON.stringify(_.extend({
    ordered: ordered
  }, cursorDescription));
  var multiplexer, observeDriver;
  var firstHandle = false; // Find a matching ObserveMultiplexer, or create a new one. This next block is
  // guaranteed to not yield (and it doesn't call anything that can observe a
  // new query), so no other calls to this function can interleave with it.

  Meteor._noYieldsAllowed(function () {
    if (_.has(self._observeMultiplexers, observeKey)) {
      multiplexer = self._observeMultiplexers[observeKey];
    } else {
      firstHandle = true; // Create a new ObserveMultiplexer.

      multiplexer = new ObserveMultiplexer({
        ordered: ordered,
        onStop: function () {
          delete self._observeMultiplexers[observeKey];
          observeDriver.stop();
        }
      });
      self._observeMultiplexers[observeKey] = multiplexer;
    }
  });

  var observeHandle = new ObserveHandle(multiplexer, callbacks);

  if (firstHandle) {
    var matcher, sorter;

    var canUseOplog = _.all([function () {
      // At a bare minimum, using the oplog requires us to have an oplog, to
      // want unordered callbacks, and to not want a callback on the polls
      // that won't happen.
      return self._oplogHandle && !ordered && !callbacks._testOnlyPollCallback;
    }, function () {
      // We need to be able to compile the selector. Fall back to polling for
      // some newfangled $selector that minimongo doesn't support yet.
      try {
        matcher = new Minimongo.Matcher(cursorDescription.selector);
        return true;
      } catch (e) {
        // XXX make all compilation errors MinimongoError or something
        //     so that this doesn't ignore unrelated exceptions
        return false;
      }
    }, function () {
      // ... and the selector itself needs to support oplog.
      return OplogObserveDriver.cursorSupported(cursorDescription, matcher);
    }, function () {
      // And we need to be able to compile the sort, if any.  eg, can't be
      // {$natural: 1}.
      if (!cursorDescription.options.sort) return true;

      try {
        sorter = new Minimongo.Sorter(cursorDescription.options.sort, {
          matcher: matcher
        });
        return true;
      } catch (e) {
        // XXX make all compilation errors MinimongoError or something
        //     so that this doesn't ignore unrelated exceptions
        return false;
      }
    }], function (f) {
      return f();
    }); // invoke each function


    var driverClass = canUseOplog ? OplogObserveDriver : PollingObserveDriver;
    observeDriver = new driverClass({
      cursorDescription: cursorDescription,
      mongoHandle: self,
      multiplexer: multiplexer,
      ordered: ordered,
      matcher: matcher,
      // ignored by polling
      sorter: sorter,
      // ignored by polling
      _testOnlyPollCallback: callbacks._testOnlyPollCallback
    }); // This field is only set for use in tests.

    multiplexer._observeDriver = observeDriver;
  } // Blocks until the initial adds have been sent.


  multiplexer.addHandleAndSendInitialAdds(observeHandle);
  return observeHandle;
}; // Listen for the invalidation messages that will trigger us to poll the
// database for changes. If this selector specifies specific IDs, specify them
// here, so that updates to different specific IDs don't cause us to poll.
// listenCallback is the same kind of (notification, complete) callback passed
// to InvalidationCrossbar.listen.


listenAll = function (cursorDescription, listenCallback) {
  var listeners = [];
  forEachTrigger(cursorDescription, function (trigger) {
    listeners.push(DDPServer._InvalidationCrossbar.listen(trigger, listenCallback));
  });
  return {
    stop: function () {
      _.each(listeners, function (listener) {
        listener.stop();
      });
    }
  };
};

forEachTrigger = function (cursorDescription, triggerCallback) {
  var key = {
    collection: cursorDescription.collectionName
  };

  var specificIds = LocalCollection._idsMatchedBySelector(cursorDescription.selector);

  if (specificIds) {
    _.each(specificIds, function (id) {
      triggerCallback(_.extend({
        id: id
      }, key));
    });

    triggerCallback(_.extend({
      dropCollection: true,
      id: null
    }, key));
  } else {
    triggerCallback(key);
  } // Everyone cares about the database being dropped.


  triggerCallback({
    dropDatabase: true
  });
}; // observeChanges for tailable cursors on capped collections.
//
// Some differences from normal cursors:
//   - Will never produce anything other than 'added' or 'addedBefore'. If you
//     do update a document that has already been produced, this will not notice
//     it.
//   - If you disconnect and reconnect from Mongo, it will essentially restart
//     the query, which will lead to duplicate results. This is pretty bad,
//     but if you include a field called 'ts' which is inserted as
//     new MongoInternals.MongoTimestamp(0, 0) (which is initialized to the
//     current Mongo-style timestamp), we'll be able to find the place to
//     restart properly. (This field is specifically understood by Mongo with an
//     optimization which allows it to find the right place to start without
//     an index on ts. It's how the oplog works.)
//   - No callbacks are triggered synchronously with the call (there's no
//     differentiation between "initial data" and "later changes"; everything
//     that matches the query gets sent asynchronously).
//   - De-duplication is not implemented.
//   - Does not yet interact with the write fence. Probably, this should work by
//     ignoring removes (which don't work on capped collections) and updates
//     (which don't affect tailable cursors), and just keeping track of the ID
//     of the inserted object, and closing the write fence once you get to that
//     ID (or timestamp?).  This doesn't work well if the document doesn't match
//     the query, though.  On the other hand, the write fence can close
//     immediately if it does not match the query. So if we trust minimongo
//     enough to accurately evaluate the query against the write fence, we
//     should be able to do this...  Of course, minimongo doesn't even support
//     Mongo Timestamps yet.


MongoConnection.prototype._observeChangesTailable = function (cursorDescription, ordered, callbacks) {
  var self = this; // Tailable cursors only ever call added/addedBefore callbacks, so it's an
  // error if you didn't provide them.

  if (ordered && !callbacks.addedBefore || !ordered && !callbacks.added) {
    throw new Error("Can't observe an " + (ordered ? "ordered" : "unordered") + " tailable cursor without a " + (ordered ? "addedBefore" : "added") + " callback");
  }

  return self.tail(cursorDescription, function (doc) {
    var id = doc._id;
    delete doc._id; // The ts is an implementation detail. Hide it.

    delete doc.ts;

    if (ordered) {
      callbacks.addedBefore(id, doc, null);
    } else {
      callbacks.added(id, doc);
    }
  });
}; // XXX We probably need to find a better way to expose this. Right now
// it's only used by tests, but in fact you need it in normal
// operation to interact with capped collections.


MongoInternals.MongoTimestamp = MongoDB.Timestamp;
MongoInternals.Connection = MongoConnection;
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"oplog_tailing.js":function(require){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/oplog_tailing.js                                                                                     //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
var Future = Npm.require('fibers/future');

OPLOG_COLLECTION = 'oplog.rs';
var TOO_FAR_BEHIND = process.env.METEOR_OPLOG_TOO_FAR_BEHIND || 2000;

var showTS = function (ts) {
  return "Timestamp(" + ts.getHighBits() + ", " + ts.getLowBits() + ")";
};

idForOp = function (op) {
  if (op.op === 'd') return op.o._id;else if (op.op === 'i') return op.o._id;else if (op.op === 'u') return op.o2._id;else if (op.op === 'c') throw Error("Operator 'c' doesn't supply an object with id: " + EJSON.stringify(op));else throw Error("Unknown op: " + EJSON.stringify(op));
};

OplogHandle = function (oplogUrl, dbName) {
  var self = this;
  self._oplogUrl = oplogUrl;
  self._dbName = dbName;
  self._oplogLastEntryConnection = null;
  self._oplogTailConnection = null;
  self._stopped = false;
  self._tailHandle = null;
  self._readyFuture = new Future();
  self._crossbar = new DDPServer._Crossbar({
    factPackage: "mongo-livedata",
    factName: "oplog-watchers"
  });
  self._baseOplogSelector = {
    ns: new RegExp('^' + Meteor._escapeRegExp(self._dbName) + '\\.'),
    $or: [{
      op: {
        $in: ['i', 'u', 'd']
      }
    }, // drop collection
    {
      op: 'c',
      'o.drop': {
        $exists: true
      }
    }, {
      op: 'c',
      'o.dropDatabase': 1
    }]
  }; // Data structures to support waitUntilCaughtUp(). Each oplog entry has a
  // MongoTimestamp object on it (which is not the same as a Date --- it's a
  // combination of time and an incrementing counter; see
  // http://docs.mongodb.org/manual/reference/bson-types/#timestamps).
  //
  // _catchingUpFutures is an array of {ts: MongoTimestamp, future: Future}
  // objects, sorted by ascending timestamp. _lastProcessedTS is the
  // MongoTimestamp of the last oplog entry we've processed.
  //
  // Each time we call waitUntilCaughtUp, we take a peek at the final oplog
  // entry in the db.  If we've already processed it (ie, it is not greater than
  // _lastProcessedTS), waitUntilCaughtUp immediately returns. Otherwise,
  // waitUntilCaughtUp makes a new Future and inserts it along with the final
  // timestamp entry that it read, into _catchingUpFutures. waitUntilCaughtUp
  // then waits on that future, which is resolved once _lastProcessedTS is
  // incremented to be past its timestamp by the worker fiber.
  //
  // XXX use a priority queue or something else that's faster than an array

  self._catchingUpFutures = [];
  self._lastProcessedTS = null;
  self._onSkippedEntriesHook = new Hook({
    debugPrintExceptions: "onSkippedEntries callback"
  });
  self._entryQueue = new Meteor._DoubleEndedQueue();
  self._workerActive = false;

  self._startTailing();
};

_.extend(OplogHandle.prototype, {
  stop: function () {
    var self = this;
    if (self._stopped) return;
    self._stopped = true;
    if (self._tailHandle) self._tailHandle.stop(); // XXX should close connections too
  },
  onOplogEntry: function (trigger, callback) {
    var self = this;
    if (self._stopped) throw new Error("Called onOplogEntry on stopped handle!"); // Calling onOplogEntry requires us to wait for the tailing to be ready.

    self._readyFuture.wait();

    var originalCallback = callback;
    callback = Meteor.bindEnvironment(function (notification) {
      // XXX can we avoid this clone by making oplog.js careful?
      originalCallback(EJSON.clone(notification));
    }, function (err) {
      Meteor._debug("Error in oplog callback", err.stack);
    });

    var listenHandle = self._crossbar.listen(trigger, callback);

    return {
      stop: function () {
        listenHandle.stop();
      }
    };
  },
  // Register a callback to be invoked any time we skip oplog entries (eg,
  // because we are too far behind).
  onSkippedEntries: function (callback) {
    var self = this;
    if (self._stopped) throw new Error("Called onSkippedEntries on stopped handle!");
    return self._onSkippedEntriesHook.register(callback);
  },
  // Calls `callback` once the oplog has been processed up to a point that is
  // roughly "now": specifically, once we've processed all ops that are
  // currently visible.
  // XXX become convinced that this is actually safe even if oplogConnection
  // is some kind of pool
  waitUntilCaughtUp: function () {
    var self = this;
    if (self._stopped) throw new Error("Called waitUntilCaughtUp on stopped handle!"); // Calling waitUntilCaughtUp requries us to wait for the oplog connection to
    // be ready.

    self._readyFuture.wait();

    var lastEntry;

    while (!self._stopped) {
      // We need to make the selector at least as restrictive as the actual
      // tailing selector (ie, we need to specify the DB name) or else we might
      // find a TS that won't show up in the actual tail stream.
      try {
        lastEntry = self._oplogLastEntryConnection.findOne(OPLOG_COLLECTION, self._baseOplogSelector, {
          fields: {
            ts: 1
          },
          sort: {
            $natural: -1
          }
        });
        break;
      } catch (e) {
        // During failover (eg) if we get an exception we should log and retry
        // instead of crashing.
        Meteor._debug("Got exception while reading last entry: " + e);

        Meteor._sleepForMs(100);
      }
    }

    if (self._stopped) return;

    if (!lastEntry) {
      // Really, nothing in the oplog? Well, we've processed everything.
      return;
    }

    var ts = lastEntry.ts;
    if (!ts) throw Error("oplog entry without ts: " + EJSON.stringify(lastEntry));

    if (self._lastProcessedTS && ts.lessThanOrEqual(self._lastProcessedTS)) {
      // We've already caught up to here.
      return;
    } // Insert the future into our list. Almost always, this will be at the end,
    // but it's conceivable that if we fail over from one primary to another,
    // the oplog entries we see will go backwards.


    var insertAfter = self._catchingUpFutures.length;

    while (insertAfter - 1 > 0 && self._catchingUpFutures[insertAfter - 1].ts.greaterThan(ts)) {
      insertAfter--;
    }

    var f = new Future();

    self._catchingUpFutures.splice(insertAfter, 0, {
      ts: ts,
      future: f
    });

    f.wait();
  },
  _startTailing: function () {
    var self = this; // First, make sure that we're talking to the local database.

    var mongodbUri = Npm.require('mongodb-uri');

    if (mongodbUri.parse(self._oplogUrl).database !== 'local') {
      throw Error("$MONGO_OPLOG_URL must be set to the 'local' database of " + "a Mongo replica set");
    } // We make two separate connections to Mongo. The Node Mongo driver
    // implements a naive round-robin connection pool: each "connection" is a
    // pool of several (5 by default) TCP connections, and each request is
    // rotated through the pools. Tailable cursor queries block on the server
    // until there is some data to return (or until a few seconds have
    // passed). So if the connection pool used for tailing cursors is the same
    // pool used for other queries, the other queries will be delayed by seconds
    // 1/5 of the time.
    //
    // The tail connection will only ever be running a single tail command, so
    // it only needs to make one underlying TCP connection.


    self._oplogTailConnection = new MongoConnection(self._oplogUrl, {
      poolSize: 1
    }); // XXX better docs, but: it's to get monotonic results
    // XXX is it safe to say "if there's an in flight query, just use its
    //     results"? I don't think so but should consider that

    self._oplogLastEntryConnection = new MongoConnection(self._oplogUrl, {
      poolSize: 1
    }); // Now, make sure that there actually is a repl set here. If not, oplog
    // tailing won't ever find anything!
    // More on the isMasterDoc
    // https://docs.mongodb.com/manual/reference/command/isMaster/

    var f = new Future();

    self._oplogLastEntryConnection.db.admin().command({
      ismaster: 1
    }, f.resolver());

    var isMasterDoc = f.wait();

    if (!(isMasterDoc && isMasterDoc.setName)) {
      throw Error("$MONGO_OPLOG_URL must be set to the 'local' database of " + "a Mongo replica set");
    } // Find the last oplog entry.


    var lastOplogEntry = self._oplogLastEntryConnection.findOne(OPLOG_COLLECTION, {}, {
      sort: {
        $natural: -1
      },
      fields: {
        ts: 1
      }
    });

    var oplogSelector = _.clone(self._baseOplogSelector);

    if (lastOplogEntry) {
      // Start after the last entry that currently exists.
      oplogSelector.ts = {
        $gt: lastOplogEntry.ts
      }; // If there are any calls to callWhenProcessedLatest before any other
      // oplog entries show up, allow callWhenProcessedLatest to call its
      // callback immediately.

      self._lastProcessedTS = lastOplogEntry.ts;
    }

    var cursorDescription = new CursorDescription(OPLOG_COLLECTION, oplogSelector, {
      tailable: true
    });
    self._tailHandle = self._oplogTailConnection.tail(cursorDescription, function (doc) {
      self._entryQueue.push(doc);

      self._maybeStartWorker();
    });

    self._readyFuture.return();
  },
  _maybeStartWorker: function () {
    var self = this;
    if (self._workerActive) return;
    self._workerActive = true;
    Meteor.defer(function () {
      try {
        while (!self._stopped && !self._entryQueue.isEmpty()) {
          // Are we too far behind? Just tell our observers that they need to
          // repoll, and drop our queue.
          if (self._entryQueue.length > TOO_FAR_BEHIND) {
            var lastEntry = self._entryQueue.pop();

            self._entryQueue.clear();

            self._onSkippedEntriesHook.each(function (callback) {
              callback();
              return true;
            }); // Free any waitUntilCaughtUp() calls that were waiting for us to
            // pass something that we just skipped.


            self._setLastProcessedTS(lastEntry.ts);

            continue;
          }

          var doc = self._entryQueue.shift();

          if (!(doc.ns && doc.ns.length > self._dbName.length + 1 && doc.ns.substr(0, self._dbName.length + 1) === self._dbName + '.')) {
            throw new Error("Unexpected ns");
          }

          var trigger = {
            collection: doc.ns.substr(self._dbName.length + 1),
            dropCollection: false,
            dropDatabase: false,
            op: doc
          }; // Is it a special command and the collection name is hidden somewhere
          // in operator?

          if (trigger.collection === "$cmd") {
            if (doc.o.dropDatabase) {
              delete trigger.collection;
              trigger.dropDatabase = true;
            } else if (_.has(doc.o, 'drop')) {
              trigger.collection = doc.o.drop;
              trigger.dropCollection = true;
              trigger.id = null;
            } else {
              throw Error("Unknown command " + JSON.stringify(doc));
            }
          } else {
            // All other ops have an id.
            trigger.id = idForOp(doc);
          }

          self._crossbar.fire(trigger); // Now that we've processed this operation, process pending
          // sequencers.


          if (!doc.ts) throw Error("oplog entry without ts: " + EJSON.stringify(doc));

          self._setLastProcessedTS(doc.ts);
        }
      } finally {
        self._workerActive = false;
      }
    });
  },
  _setLastProcessedTS: function (ts) {
    var self = this;
    self._lastProcessedTS = ts;

    while (!_.isEmpty(self._catchingUpFutures) && self._catchingUpFutures[0].ts.lessThanOrEqual(self._lastProcessedTS)) {
      var sequencer = self._catchingUpFutures.shift();

      sequencer.future.return();
    }
  },
  //Methods used on tests to dinamically change TOO_FAR_BEHIND
  _defineTooFarBehind: function (value) {
    TOO_FAR_BEHIND = value;
  },
  _resetTooFarBehind: function () {
    TOO_FAR_BEHIND = process.env.METEOR_OPLOG_TOO_FAR_BEHIND || 2000;
  }
});
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"observe_multiplex.js":function(require){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/observe_multiplex.js                                                                                 //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
var Future = Npm.require('fibers/future');

ObserveMultiplexer = function (options) {
  var self = this;
  if (!options || !_.has(options, 'ordered')) throw Error("must specified ordered");
  Package.facts && Package.facts.Facts.incrementServerFact("mongo-livedata", "observe-multiplexers", 1);
  self._ordered = options.ordered;

  self._onStop = options.onStop || function () {};

  self._queue = new Meteor._SynchronousQueue();
  self._handles = {};
  self._readyFuture = new Future();
  self._cache = new LocalCollection._CachingChangeObserver({
    ordered: options.ordered
  }); // Number of addHandleAndSendInitialAdds tasks scheduled but not yet
  // running. removeHandle uses this to know if it's time to call the onStop
  // callback.

  self._addHandleTasksScheduledButNotPerformed = 0;

  _.each(self.callbackNames(), function (callbackName) {
    self[callbackName] = function ()
    /* ... */
    {
      self._applyCallback(callbackName, _.toArray(arguments));
    };
  });
};

_.extend(ObserveMultiplexer.prototype, {
  addHandleAndSendInitialAdds: function (handle) {
    var self = this; // Check this before calling runTask (even though runTask does the same
    // check) so that we don't leak an ObserveMultiplexer on error by
    // incrementing _addHandleTasksScheduledButNotPerformed and never
    // decrementing it.

    if (!self._queue.safeToRunTask()) throw new Error("Can't call observeChanges from an observe callback on the same query");
    ++self._addHandleTasksScheduledButNotPerformed;
    Package.facts && Package.facts.Facts.incrementServerFact("mongo-livedata", "observe-handles", 1);

    self._queue.runTask(function () {
      self._handles[handle._id] = handle; // Send out whatever adds we have so far (whether or not we the
      // multiplexer is ready).

      self._sendAdds(handle);

      --self._addHandleTasksScheduledButNotPerformed;
    }); // *outside* the task, since otherwise we'd deadlock


    self._readyFuture.wait();
  },
  // Remove an observe handle. If it was the last observe handle, call the
  // onStop callback; you cannot add any more observe handles after this.
  //
  // This is not synchronized with polls and handle additions: this means that
  // you can safely call it from within an observe callback, but it also means
  // that we have to be careful when we iterate over _handles.
  removeHandle: function (id) {
    var self = this; // This should not be possible: you can only call removeHandle by having
    // access to the ObserveHandle, which isn't returned to user code until the
    // multiplex is ready.

    if (!self._ready()) throw new Error("Can't remove handles until the multiplex is ready");
    delete self._handles[id];
    Package.facts && Package.facts.Facts.incrementServerFact("mongo-livedata", "observe-handles", -1);

    if (_.isEmpty(self._handles) && self._addHandleTasksScheduledButNotPerformed === 0) {
      self._stop();
    }
  },
  _stop: function (options) {
    var self = this;
    options = options || {}; // It shouldn't be possible for us to stop when all our handles still
    // haven't been returned from observeChanges!

    if (!self._ready() && !options.fromQueryError) throw Error("surprising _stop: not ready"); // Call stop callback (which kills the underlying process which sends us
    // callbacks and removes us from the connection's dictionary).

    self._onStop();

    Package.facts && Package.facts.Facts.incrementServerFact("mongo-livedata", "observe-multiplexers", -1); // Cause future addHandleAndSendInitialAdds calls to throw (but the onStop
    // callback should make our connection forget about us).

    self._handles = null;
  },
  // Allows all addHandleAndSendInitialAdds calls to return, once all preceding
  // adds have been processed. Does not block.
  ready: function () {
    var self = this;

    self._queue.queueTask(function () {
      if (self._ready()) throw Error("can't make ObserveMultiplex ready twice!");

      self._readyFuture.return();
    });
  },
  // If trying to execute the query results in an error, call this. This is
  // intended for permanent errors, not transient network errors that could be
  // fixed. It should only be called before ready(), because if you called ready
  // that meant that you managed to run the query once. It will stop this
  // ObserveMultiplex and cause addHandleAndSendInitialAdds calls (and thus
  // observeChanges calls) to throw the error.
  queryError: function (err) {
    var self = this;

    self._queue.runTask(function () {
      if (self._ready()) throw Error("can't claim query has an error after it worked!");

      self._stop({
        fromQueryError: true
      });

      self._readyFuture.throw(err);
    });
  },
  // Calls "cb" once the effects of all "ready", "addHandleAndSendInitialAdds"
  // and observe callbacks which came before this call have been propagated to
  // all handles. "ready" must have already been called on this multiplexer.
  onFlush: function (cb) {
    var self = this;

    self._queue.queueTask(function () {
      if (!self._ready()) throw Error("only call onFlush on a multiplexer that will be ready");
      cb();
    });
  },
  callbackNames: function () {
    var self = this;
    if (self._ordered) return ["addedBefore", "changed", "movedBefore", "removed"];else return ["added", "changed", "removed"];
  },
  _ready: function () {
    return this._readyFuture.isResolved();
  },
  _applyCallback: function (callbackName, args) {
    var self = this;

    self._queue.queueTask(function () {
      // If we stopped in the meantime, do nothing.
      if (!self._handles) return; // First, apply the change to the cache.
      // XXX We could make applyChange callbacks promise not to hang on to any
      // state from their arguments (assuming that their supplied callbacks
      // don't) and skip this clone. Currently 'changed' hangs on to state
      // though.

      self._cache.applyChange[callbackName].apply(null, EJSON.clone(args)); // If we haven't finished the initial adds, then we should only be getting
      // adds.


      if (!self._ready() && callbackName !== 'added' && callbackName !== 'addedBefore') {
        throw new Error("Got " + callbackName + " during initial adds");
      } // Now multiplex the callbacks out to all observe handles. It's OK if
      // these calls yield; since we're inside a task, no other use of our queue
      // can continue until these are done. (But we do have to be careful to not
      // use a handle that got removed, because removeHandle does not use the
      // queue; thus, we iterate over an array of keys that we control.)


      _.each(_.keys(self._handles), function (handleId) {
        var handle = self._handles && self._handles[handleId];
        if (!handle) return;
        var callback = handle['_' + callbackName]; // clone arguments so that callbacks can mutate their arguments

        callback && callback.apply(null, EJSON.clone(args));
      });
    });
  },
  // Sends initial adds to a handle. It should only be called from within a task
  // (the task that is processing the addHandleAndSendInitialAdds call). It
  // synchronously invokes the handle's added or addedBefore; there's no need to
  // flush the queue afterwards to ensure that the callbacks get out.
  _sendAdds: function (handle) {
    var self = this;
    if (self._queue.safeToRunTask()) throw Error("_sendAdds may only be called from within a task!");
    var add = self._ordered ? handle._addedBefore : handle._added;
    if (!add) return; // note: docs may be an _IdMap or an OrderedDict

    self._cache.docs.forEach(function (doc, id) {
      if (!_.has(self._handles, handle._id)) throw Error("handle got removed before sending initial adds!");
      var fields = EJSON.clone(doc);
      delete fields._id;
      if (self._ordered) add(id, fields, null); // we're going in order, so add at end
      else add(id, fields);
    });
  }
});

var nextObserveHandleId = 1;

ObserveHandle = function (multiplexer, callbacks) {
  var self = this; // The end user is only supposed to call stop().  The other fields are
  // accessible to the multiplexer, though.

  self._multiplexer = multiplexer;

  _.each(multiplexer.callbackNames(), function (name) {
    if (callbacks[name]) {
      self['_' + name] = callbacks[name];
    } else if (name === "addedBefore" && callbacks.added) {
      // Special case: if you specify "added" and "movedBefore", you get an
      // ordered observe where for some reason you don't get ordering data on
      // the adds.  I dunno, we wrote tests for it, there must have been a
      // reason.
      self._addedBefore = function (id, fields, before) {
        callbacks.added(id, fields);
      };
    }
  });

  self._stopped = false;
  self._id = nextObserveHandleId++;
};

ObserveHandle.prototype.stop = function () {
  var self = this;
  if (self._stopped) return;
  self._stopped = true;

  self._multiplexer.removeHandle(self._id);
};
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"doc_fetcher.js":function(require){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/doc_fetcher.js                                                                                       //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
var Fiber = Npm.require('fibers');

var Future = Npm.require('fibers/future');

DocFetcher = function (mongoConnection) {
  var self = this;
  self._mongoConnection = mongoConnection; // Map from cache key -> [callback]

  self._callbacksForCacheKey = {};
};

_.extend(DocFetcher.prototype, {
  // Fetches document "id" from collectionName, returning it or null if not
  // found.
  //
  // If you make multiple calls to fetch() with the same cacheKey (a string),
  // DocFetcher may assume that they all return the same document. (It does
  // not check to see if collectionName/id match.)
  //
  // You may assume that callback is never called synchronously (and in fact
  // OplogObserveDriver does so).
  fetch: function (collectionName, id, cacheKey, callback) {
    var self = this;
    check(collectionName, String); // id is some sort of scalar

    check(cacheKey, String); // If there's already an in-progress fetch for this cache key, yield until
    // it's done and return whatever it returns.

    if (_.has(self._callbacksForCacheKey, cacheKey)) {
      self._callbacksForCacheKey[cacheKey].push(callback);

      return;
    }

    var callbacks = self._callbacksForCacheKey[cacheKey] = [callback];
    Fiber(function () {
      try {
        var doc = self._mongoConnection.findOne(collectionName, {
          _id: id
        }) || null; // Return doc to all relevant callbacks. Note that this array can
        // continue to grow during callback excecution.

        while (!_.isEmpty(callbacks)) {
          // Clone the document so that the various calls to fetch don't return
          // objects that are intertwingled with each other. Clone before
          // popping the future, so that if clone throws, the error gets passed
          // to the next callback.
          var clonedDoc = EJSON.clone(doc);
          callbacks.pop()(null, clonedDoc);
        }
      } catch (e) {
        while (!_.isEmpty(callbacks)) {
          callbacks.pop()(e);
        }
      } finally {
        // XXX consider keeping the doc around for a period of time before
        // removing from the cache
        delete self._callbacksForCacheKey[cacheKey];
      }
    }).run();
  }
});

MongoTest.DocFetcher = DocFetcher;
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"polling_observe_driver.js":function(){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/polling_observe_driver.js                                                                            //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
PollingObserveDriver = function (options) {
  var self = this;
  self._cursorDescription = options.cursorDescription;
  self._mongoHandle = options.mongoHandle;
  self._ordered = options.ordered;
  self._multiplexer = options.multiplexer;
  self._stopCallbacks = [];
  self._stopped = false;
  self._synchronousCursor = self._mongoHandle._createSynchronousCursor(self._cursorDescription); // previous results snapshot.  on each poll cycle, diffs against
  // results drives the callbacks.

  self._results = null; // The number of _pollMongo calls that have been added to self._taskQueue but
  // have not started running. Used to make sure we never schedule more than one
  // _pollMongo (other than possibly the one that is currently running). It's
  // also used by _suspendPolling to pretend there's a poll scheduled. Usually,
  // it's either 0 (for "no polls scheduled other than maybe one currently
  // running") or 1 (for "a poll scheduled that isn't running yet"), but it can
  // also be 2 if incremented by _suspendPolling.

  self._pollsScheduledButNotStarted = 0;
  self._pendingWrites = []; // people to notify when polling completes
  // Make sure to create a separately throttled function for each
  // PollingObserveDriver object.

  self._ensurePollIsScheduled = _.throttle(self._unthrottledEnsurePollIsScheduled, self._cursorDescription.options.pollingThrottleMs || 50
  /* ms */
  ); // XXX figure out if we still need a queue

  self._taskQueue = new Meteor._SynchronousQueue();
  var listenersHandle = listenAll(self._cursorDescription, function (notification) {
    // When someone does a transaction that might affect us, schedule a poll
    // of the database. If that transaction happens inside of a write fence,
    // block the fence until we've polled and notified observers.
    var fence = DDPServer._CurrentWriteFence.get();

    if (fence) self._pendingWrites.push(fence.beginWrite()); // Ensure a poll is scheduled... but if we already know that one is,
    // don't hit the throttled _ensurePollIsScheduled function (which might
    // lead to us calling it unnecessarily in <pollingThrottleMs> ms).

    if (self._pollsScheduledButNotStarted === 0) self._ensurePollIsScheduled();
  });

  self._stopCallbacks.push(function () {
    listenersHandle.stop();
  }); // every once and a while, poll even if we don't think we're dirty, for
  // eventual consistency with database writes from outside the Meteor
  // universe.
  //
  // For testing, there's an undocumented callback argument to observeChanges
  // which disables time-based polling and gets called at the beginning of each
  // poll.


  if (options._testOnlyPollCallback) {
    self._testOnlyPollCallback = options._testOnlyPollCallback;
  } else {
    var pollingInterval = self._cursorDescription.options.pollingIntervalMs || self._cursorDescription.options._pollingInterval || // COMPAT with 1.2
    10 * 1000;
    var intervalHandle = Meteor.setInterval(_.bind(self._ensurePollIsScheduled, self), pollingInterval);

    self._stopCallbacks.push(function () {
      Meteor.clearInterval(intervalHandle);
    });
  } // Make sure we actually poll soon!


  self._unthrottledEnsurePollIsScheduled();

  Package.facts && Package.facts.Facts.incrementServerFact("mongo-livedata", "observe-drivers-polling", 1);
};

_.extend(PollingObserveDriver.prototype, {
  // This is always called through _.throttle (except once at startup).
  _unthrottledEnsurePollIsScheduled: function () {
    var self = this;
    if (self._pollsScheduledButNotStarted > 0) return;
    ++self._pollsScheduledButNotStarted;

    self._taskQueue.queueTask(function () {
      self._pollMongo();
    });
  },
  // test-only interface for controlling polling.
  //
  // _suspendPolling blocks until any currently running and scheduled polls are
  // done, and prevents any further polls from being scheduled. (new
  // ObserveHandles can be added and receive their initial added callbacks,
  // though.)
  //
  // _resumePolling immediately polls, and allows further polls to occur.
  _suspendPolling: function () {
    var self = this; // Pretend that there's another poll scheduled (which will prevent
    // _ensurePollIsScheduled from queueing any more polls).

    ++self._pollsScheduledButNotStarted; // Now block until all currently running or scheduled polls are done.

    self._taskQueue.runTask(function () {}); // Confirm that there is only one "poll" (the fake one we're pretending to
    // have) scheduled.


    if (self._pollsScheduledButNotStarted !== 1) throw new Error("_pollsScheduledButNotStarted is " + self._pollsScheduledButNotStarted);
  },
  _resumePolling: function () {
    var self = this; // We should be in the same state as in the end of _suspendPolling.

    if (self._pollsScheduledButNotStarted !== 1) throw new Error("_pollsScheduledButNotStarted is " + self._pollsScheduledButNotStarted); // Run a poll synchronously (which will counteract the
    // ++_pollsScheduledButNotStarted from _suspendPolling).

    self._taskQueue.runTask(function () {
      self._pollMongo();
    });
  },
  _pollMongo: function () {
    var self = this;
    --self._pollsScheduledButNotStarted;
    if (self._stopped) return;
    var first = false;
    var newResults;
    var oldResults = self._results;

    if (!oldResults) {
      first = true; // XXX maybe use OrderedDict instead?

      oldResults = self._ordered ? [] : new LocalCollection._IdMap();
    }

    self._testOnlyPollCallback && self._testOnlyPollCallback(); // Save the list of pending writes which this round will commit.

    var writesForCycle = self._pendingWrites;
    self._pendingWrites = []; // Get the new query results. (This yields.)

    try {
      newResults = self._synchronousCursor.getRawObjects(self._ordered);
    } catch (e) {
      if (first && typeof e.code === 'number') {
        // This is an error document sent to us by mongod, not a connection
        // error generated by the client. And we've never seen this query work
        // successfully. Probably it's a bad selector or something, so we should
        // NOT retry. Instead, we should halt the observe (which ends up calling
        // `stop` on us).
        self._multiplexer.queryError(new Error("Exception while polling query " + JSON.stringify(self._cursorDescription) + ": " + e.message));

        return;
      } // getRawObjects can throw if we're having trouble talking to the
      // database.  That's fine --- we will repoll later anyway. But we should
      // make sure not to lose track of this cycle's writes.
      // (It also can throw if there's just something invalid about this query;
      // unfortunately the ObserveDriver API doesn't provide a good way to
      // "cancel" the observe from the inside in this case.


      Array.prototype.push.apply(self._pendingWrites, writesForCycle);

      Meteor._debug("Exception while polling query " + JSON.stringify(self._cursorDescription) + ": " + e.stack);

      return;
    } // Run diffs.


    if (!self._stopped) {
      LocalCollection._diffQueryChanges(self._ordered, oldResults, newResults, self._multiplexer);
    } // Signals the multiplexer to allow all observeChanges calls that share this
    // multiplexer to return. (This happens asynchronously, via the
    // multiplexer's queue.)


    if (first) self._multiplexer.ready(); // Replace self._results atomically.  (This assignment is what makes `first`
    // stay through on the next cycle, so we've waited until after we've
    // committed to ready-ing the multiplexer.)

    self._results = newResults; // Once the ObserveMultiplexer has processed everything we've done in this
    // round, mark all the writes which existed before this call as
    // commmitted. (If new writes have shown up in the meantime, there'll
    // already be another _pollMongo task scheduled.)

    self._multiplexer.onFlush(function () {
      _.each(writesForCycle, function (w) {
        w.committed();
      });
    });
  },
  stop: function () {
    var self = this;
    self._stopped = true;

    _.each(self._stopCallbacks, function (c) {
      c();
    }); // Release any write fences that are waiting on us.


    _.each(self._pendingWrites, function (w) {
      w.committed();
    });

    Package.facts && Package.facts.Facts.incrementServerFact("mongo-livedata", "observe-drivers-polling", -1);
  }
});
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"oplog_observe_driver.js":function(require){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/oplog_observe_driver.js                                                                              //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
var Future = Npm.require('fibers/future');

var PHASE = {
  QUERYING: "QUERYING",
  FETCHING: "FETCHING",
  STEADY: "STEADY"
}; // Exception thrown by _needToPollQuery which unrolls the stack up to the
// enclosing call to finishIfNeedToPollQuery.

var SwitchedToQuery = function () {};

var finishIfNeedToPollQuery = function (f) {
  return function () {
    try {
      f.apply(this, arguments);
    } catch (e) {
      if (!(e instanceof SwitchedToQuery)) throw e;
    }
  };
};

var currentId = 0; // OplogObserveDriver is an alternative to PollingObserveDriver which follows
// the Mongo operation log instead of just re-polling the query. It obeys the
// same simple interface: constructing it starts sending observeChanges
// callbacks (and a ready() invocation) to the ObserveMultiplexer, and you stop
// it by calling the stop() method.

OplogObserveDriver = function (options) {
  var self = this;
  self._usesOplog = true; // tests look at this

  self._id = currentId;
  currentId++;
  self._cursorDescription = options.cursorDescription;
  self._mongoHandle = options.mongoHandle;
  self._multiplexer = options.multiplexer;

  if (options.ordered) {
    throw Error("OplogObserveDriver only supports unordered observeChanges");
  }

  var sorter = options.sorter; // We don't support $near and other geo-queries so it's OK to initialize the
  // comparator only once in the constructor.

  var comparator = sorter && sorter.getComparator();

  if (options.cursorDescription.options.limit) {
    // There are several properties ordered driver implements:
    // - _limit is a positive number
    // - _comparator is a function-comparator by which the query is ordered
    // - _unpublishedBuffer is non-null Min/Max Heap,
    //                      the empty buffer in STEADY phase implies that the
    //                      everything that matches the queries selector fits
    //                      into published set.
    // - _published - Min Heap (also implements IdMap methods)
    var heapOptions = {
      IdMap: LocalCollection._IdMap
    };
    self._limit = self._cursorDescription.options.limit;
    self._comparator = comparator;
    self._sorter = sorter;
    self._unpublishedBuffer = new MinMaxHeap(comparator, heapOptions); // We need something that can find Max value in addition to IdMap interface

    self._published = new MaxHeap(comparator, heapOptions);
  } else {
    self._limit = 0;
    self._comparator = null;
    self._sorter = null;
    self._unpublishedBuffer = null;
    self._published = new LocalCollection._IdMap();
  } // Indicates if it is safe to insert a new document at the end of the buffer
  // for this query. i.e. it is known that there are no documents matching the
  // selector those are not in published or buffer.


  self._safeAppendToBuffer = false;
  self._stopped = false;
  self._stopHandles = [];
  Package.facts && Package.facts.Facts.incrementServerFact("mongo-livedata", "observe-drivers-oplog", 1);

  self._registerPhaseChange(PHASE.QUERYING);

  self._matcher = options.matcher;
  var projection = self._cursorDescription.options.fields || {};
  self._projectionFn = LocalCollection._compileProjection(projection); // Projection function, result of combining important fields for selector and
  // existing fields projection

  self._sharedProjection = self._matcher.combineIntoProjection(projection);
  if (sorter) self._sharedProjection = sorter.combineIntoProjection(self._sharedProjection);
  self._sharedProjectionFn = LocalCollection._compileProjection(self._sharedProjection);
  self._needToFetch = new LocalCollection._IdMap();
  self._currentlyFetching = null;
  self._fetchGeneration = 0;
  self._requeryWhenDoneThisQuery = false;
  self._writesToCommitWhenWeReachSteady = []; // If the oplog handle tells us that it skipped some entries (because it got
  // behind, say), re-poll.

  self._stopHandles.push(self._mongoHandle._oplogHandle.onSkippedEntries(finishIfNeedToPollQuery(function () {
    self._needToPollQuery();
  })));

  forEachTrigger(self._cursorDescription, function (trigger) {
    self._stopHandles.push(self._mongoHandle._oplogHandle.onOplogEntry(trigger, function (notification) {
      Meteor._noYieldsAllowed(finishIfNeedToPollQuery(function () {
        var op = notification.op;

        if (notification.dropCollection || notification.dropDatabase) {
          // Note: this call is not allowed to block on anything (especially
          // on waiting for oplog entries to catch up) because that will block
          // onOplogEntry!
          self._needToPollQuery();
        } else {
          // All other operators should be handled depending on phase
          if (self._phase === PHASE.QUERYING) {
            self._handleOplogEntryQuerying(op);
          } else {
            self._handleOplogEntrySteadyOrFetching(op);
          }
        }
      }));
    }));
  }); // XXX ordering w.r.t. everything else?

  self._stopHandles.push(listenAll(self._cursorDescription, function (notification) {
    // If we're not in a pre-fire write fence, we don't have to do anything.
    var fence = DDPServer._CurrentWriteFence.get();

    if (!fence || fence.fired) return;

    if (fence._oplogObserveDrivers) {
      fence._oplogObserveDrivers[self._id] = self;
      return;
    }

    fence._oplogObserveDrivers = {};
    fence._oplogObserveDrivers[self._id] = self;
    fence.onBeforeFire(function () {
      var drivers = fence._oplogObserveDrivers;
      delete fence._oplogObserveDrivers; // This fence cannot fire until we've caught up to "this point" in the
      // oplog, and all observers made it back to the steady state.

      self._mongoHandle._oplogHandle.waitUntilCaughtUp();

      _.each(drivers, function (driver) {
        if (driver._stopped) return;
        var write = fence.beginWrite();

        if (driver._phase === PHASE.STEADY) {
          // Make sure that all of the callbacks have made it through the
          // multiplexer and been delivered to ObserveHandles before committing
          // writes.
          driver._multiplexer.onFlush(function () {
            write.committed();
          });
        } else {
          driver._writesToCommitWhenWeReachSteady.push(write);
        }
      });
    });
  })); // When Mongo fails over, we need to repoll the query, in case we processed an
  // oplog entry that got rolled back.


  self._stopHandles.push(self._mongoHandle._onFailover(finishIfNeedToPollQuery(function () {
    self._needToPollQuery();
  }))); // Give _observeChanges a chance to add the new ObserveHandle to our
  // multiplexer, so that the added calls get streamed.


  Meteor.defer(finishIfNeedToPollQuery(function () {
    self._runInitialQuery();
  }));
};

_.extend(OplogObserveDriver.prototype, {
  _addPublished: function (id, doc) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      var fields = _.clone(doc);

      delete fields._id;

      self._published.set(id, self._sharedProjectionFn(doc));

      self._multiplexer.added(id, self._projectionFn(fields)); // After adding this document, the published set might be overflowed
      // (exceeding capacity specified by limit). If so, push the maximum
      // element to the buffer, we might want to save it in memory to reduce the
      // amount of Mongo lookups in the future.


      if (self._limit && self._published.size() > self._limit) {
        // XXX in theory the size of published is no more than limit+1
        if (self._published.size() !== self._limit + 1) {
          throw new Error("After adding to published, " + (self._published.size() - self._limit) + " documents are overflowing the set");
        }

        var overflowingDocId = self._published.maxElementId();

        var overflowingDoc = self._published.get(overflowingDocId);

        if (EJSON.equals(overflowingDocId, id)) {
          throw new Error("The document just added is overflowing the published set");
        }

        self._published.remove(overflowingDocId);

        self._multiplexer.removed(overflowingDocId);

        self._addBuffered(overflowingDocId, overflowingDoc);
      }
    });
  },
  _removePublished: function (id) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._published.remove(id);

      self._multiplexer.removed(id);

      if (!self._limit || self._published.size() === self._limit) return;
      if (self._published.size() > self._limit) throw Error("self._published got too big"); // OK, we are publishing less than the limit. Maybe we should look in the
      // buffer to find the next element past what we were publishing before.

      if (!self._unpublishedBuffer.empty()) {
        // There's something in the buffer; move the first thing in it to
        // _published.
        var newDocId = self._unpublishedBuffer.minElementId();

        var newDoc = self._unpublishedBuffer.get(newDocId);

        self._removeBuffered(newDocId);

        self._addPublished(newDocId, newDoc);

        return;
      } // There's nothing in the buffer.  This could mean one of a few things.
      // (a) We could be in the middle of re-running the query (specifically, we
      // could be in _publishNewResults). In that case, _unpublishedBuffer is
      // empty because we clear it at the beginning of _publishNewResults. In
      // this case, our caller already knows the entire answer to the query and
      // we don't need to do anything fancy here.  Just return.


      if (self._phase === PHASE.QUERYING) return; // (b) We're pretty confident that the union of _published and
      // _unpublishedBuffer contain all documents that match selector. Because
      // _unpublishedBuffer is empty, that means we're confident that _published
      // contains all documents that match selector. So we have nothing to do.

      if (self._safeAppendToBuffer) return; // (c) Maybe there are other documents out there that should be in our
      // buffer. But in that case, when we emptied _unpublishedBuffer in
      // _removeBuffered, we should have called _needToPollQuery, which will
      // either put something in _unpublishedBuffer or set _safeAppendToBuffer
      // (or both), and it will put us in QUERYING for that whole time. So in
      // fact, we shouldn't be able to get here.

      throw new Error("Buffer inexplicably empty");
    });
  },
  _changePublished: function (id, oldDoc, newDoc) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._published.set(id, self._sharedProjectionFn(newDoc));

      var projectedNew = self._projectionFn(newDoc);

      var projectedOld = self._projectionFn(oldDoc);

      var changed = DiffSequence.makeChangedFields(projectedNew, projectedOld);
      if (!_.isEmpty(changed)) self._multiplexer.changed(id, changed);
    });
  },
  _addBuffered: function (id, doc) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._unpublishedBuffer.set(id, self._sharedProjectionFn(doc)); // If something is overflowing the buffer, we just remove it from cache


      if (self._unpublishedBuffer.size() > self._limit) {
        var maxBufferedId = self._unpublishedBuffer.maxElementId();

        self._unpublishedBuffer.remove(maxBufferedId); // Since something matching is removed from cache (both published set and
        // buffer), set flag to false


        self._safeAppendToBuffer = false;
      }
    });
  },
  // Is called either to remove the doc completely from matching set or to move
  // it to the published set later.
  _removeBuffered: function (id) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._unpublishedBuffer.remove(id); // To keep the contract "buffer is never empty in STEADY phase unless the
      // everything matching fits into published" true, we poll everything as
      // soon as we see the buffer becoming empty.


      if (!self._unpublishedBuffer.size() && !self._safeAppendToBuffer) self._needToPollQuery();
    });
  },
  // Called when a document has joined the "Matching" results set.
  // Takes responsibility of keeping _unpublishedBuffer in sync with _published
  // and the effect of limit enforced.
  _addMatching: function (doc) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      var id = doc._id;
      if (self._published.has(id)) throw Error("tried to add something already published " + id);
      if (self._limit && self._unpublishedBuffer.has(id)) throw Error("tried to add something already existed in buffer " + id);
      var limit = self._limit;
      var comparator = self._comparator;
      var maxPublished = limit && self._published.size() > 0 ? self._published.get(self._published.maxElementId()) : null;
      var maxBuffered = limit && self._unpublishedBuffer.size() > 0 ? self._unpublishedBuffer.get(self._unpublishedBuffer.maxElementId()) : null; // The query is unlimited or didn't publish enough documents yet or the
      // new document would fit into published set pushing the maximum element
      // out, then we need to publish the doc.

      var toPublish = !limit || self._published.size() < limit || comparator(doc, maxPublished) < 0; // Otherwise we might need to buffer it (only in case of limited query).
      // Buffering is allowed if the buffer is not filled up yet and all
      // matching docs are either in the published set or in the buffer.

      var canAppendToBuffer = !toPublish && self._safeAppendToBuffer && self._unpublishedBuffer.size() < limit; // Or if it is small enough to be safely inserted to the middle or the
      // beginning of the buffer.

      var canInsertIntoBuffer = !toPublish && maxBuffered && comparator(doc, maxBuffered) <= 0;
      var toBuffer = canAppendToBuffer || canInsertIntoBuffer;

      if (toPublish) {
        self._addPublished(id, doc);
      } else if (toBuffer) {
        self._addBuffered(id, doc);
      } else {
        // dropping it and not saving to the cache
        self._safeAppendToBuffer = false;
      }
    });
  },
  // Called when a document leaves the "Matching" results set.
  // Takes responsibility of keeping _unpublishedBuffer in sync with _published
  // and the effect of limit enforced.
  _removeMatching: function (id) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      if (!self._published.has(id) && !self._limit) throw Error("tried to remove something matching but not cached " + id);

      if (self._published.has(id)) {
        self._removePublished(id);
      } else if (self._unpublishedBuffer.has(id)) {
        self._removeBuffered(id);
      }
    });
  },
  _handleDoc: function (id, newDoc) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      var matchesNow = newDoc && self._matcher.documentMatches(newDoc).result;

      var publishedBefore = self._published.has(id);

      var bufferedBefore = self._limit && self._unpublishedBuffer.has(id);

      var cachedBefore = publishedBefore || bufferedBefore;

      if (matchesNow && !cachedBefore) {
        self._addMatching(newDoc);
      } else if (cachedBefore && !matchesNow) {
        self._removeMatching(id);
      } else if (cachedBefore && matchesNow) {
        var oldDoc = self._published.get(id);

        var comparator = self._comparator;

        var minBuffered = self._limit && self._unpublishedBuffer.size() && self._unpublishedBuffer.get(self._unpublishedBuffer.minElementId());

        var maxBuffered;

        if (publishedBefore) {
          // Unlimited case where the document stays in published once it
          // matches or the case when we don't have enough matching docs to
          // publish or the changed but matching doc will stay in published
          // anyways.
          //
          // XXX: We rely on the emptiness of buffer. Be sure to maintain the
          // fact that buffer can't be empty if there are matching documents not
          // published. Notably, we don't want to schedule repoll and continue
          // relying on this property.
          var staysInPublished = !self._limit || self._unpublishedBuffer.size() === 0 || comparator(newDoc, minBuffered) <= 0;

          if (staysInPublished) {
            self._changePublished(id, oldDoc, newDoc);
          } else {
            // after the change doc doesn't stay in the published, remove it
            self._removePublished(id); // but it can move into buffered now, check it


            maxBuffered = self._unpublishedBuffer.get(self._unpublishedBuffer.maxElementId());
            var toBuffer = self._safeAppendToBuffer || maxBuffered && comparator(newDoc, maxBuffered) <= 0;

            if (toBuffer) {
              self._addBuffered(id, newDoc);
            } else {
              // Throw away from both published set and buffer
              self._safeAppendToBuffer = false;
            }
          }
        } else if (bufferedBefore) {
          oldDoc = self._unpublishedBuffer.get(id); // remove the old version manually instead of using _removeBuffered so
          // we don't trigger the querying immediately.  if we end this block
          // with the buffer empty, we will need to trigger the query poll
          // manually too.

          self._unpublishedBuffer.remove(id);

          var maxPublished = self._published.get(self._published.maxElementId());

          maxBuffered = self._unpublishedBuffer.size() && self._unpublishedBuffer.get(self._unpublishedBuffer.maxElementId()); // the buffered doc was updated, it could move to published

          var toPublish = comparator(newDoc, maxPublished) < 0; // or stays in buffer even after the change

          var staysInBuffer = !toPublish && self._safeAppendToBuffer || !toPublish && maxBuffered && comparator(newDoc, maxBuffered) <= 0;

          if (toPublish) {
            self._addPublished(id, newDoc);
          } else if (staysInBuffer) {
            // stays in buffer but changes
            self._unpublishedBuffer.set(id, newDoc);
          } else {
            // Throw away from both published set and buffer
            self._safeAppendToBuffer = false; // Normally this check would have been done in _removeBuffered but
            // we didn't use it, so we need to do it ourself now.

            if (!self._unpublishedBuffer.size()) {
              self._needToPollQuery();
            }
          }
        } else {
          throw new Error("cachedBefore implies either of publishedBefore or bufferedBefore is true.");
        }
      }
    });
  },
  _fetchModifiedDocuments: function () {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._registerPhaseChange(PHASE.FETCHING); // Defer, because nothing called from the oplog entry handler may yield,
      // but fetch() yields.


      Meteor.defer(finishIfNeedToPollQuery(function () {
        while (!self._stopped && !self._needToFetch.empty()) {
          if (self._phase === PHASE.QUERYING) {
            // While fetching, we decided to go into QUERYING mode, and then we
            // saw another oplog entry, so _needToFetch is not empty. But we
            // shouldn't fetch these documents until AFTER the query is done.
            break;
          } // Being in steady phase here would be surprising.


          if (self._phase !== PHASE.FETCHING) throw new Error("phase in fetchModifiedDocuments: " + self._phase);
          self._currentlyFetching = self._needToFetch;
          var thisGeneration = ++self._fetchGeneration;
          self._needToFetch = new LocalCollection._IdMap();
          var waiting = 0;
          var fut = new Future(); // This loop is safe, because _currentlyFetching will not be updated
          // during this loop (in fact, it is never mutated).

          self._currentlyFetching.forEach(function (cacheKey, id) {
            waiting++;

            self._mongoHandle._docFetcher.fetch(self._cursorDescription.collectionName, id, cacheKey, finishIfNeedToPollQuery(function (err, doc) {
              try {
                if (err) {
                  Meteor._debug("Got exception while fetching documents: " + err); // If we get an error from the fetcher (eg, trouble
                  // connecting to Mongo), let's just abandon the fetch phase
                  // altogether and fall back to polling. It's not like we're
                  // getting live updates anyway.


                  if (self._phase !== PHASE.QUERYING) {
                    self._needToPollQuery();
                  }
                } else if (!self._stopped && self._phase === PHASE.FETCHING && self._fetchGeneration === thisGeneration) {
                  // We re-check the generation in case we've had an explicit
                  // _pollQuery call (eg, in another fiber) which should
                  // effectively cancel this round of fetches.  (_pollQuery
                  // increments the generation.)
                  self._handleDoc(id, doc);
                }
              } finally {
                waiting--; // Because fetch() never calls its callback synchronously,
                // this is safe (ie, we won't call fut.return() before the
                // forEach is done).

                if (waiting === 0) fut.return();
              }
            }));
          });

          fut.wait(); // Exit now if we've had a _pollQuery call (here or in another fiber).

          if (self._phase === PHASE.QUERYING) return;
          self._currentlyFetching = null;
        } // We're done fetching, so we can be steady, unless we've had a
        // _pollQuery call (here or in another fiber).


        if (self._phase !== PHASE.QUERYING) self._beSteady();
      }));
    });
  },
  _beSteady: function () {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._registerPhaseChange(PHASE.STEADY);

      var writes = self._writesToCommitWhenWeReachSteady;
      self._writesToCommitWhenWeReachSteady = [];

      self._multiplexer.onFlush(function () {
        _.each(writes, function (w) {
          w.committed();
        });
      });
    });
  },
  _handleOplogEntryQuerying: function (op) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._needToFetch.set(idForOp(op), op.ts.toString());
    });
  },
  _handleOplogEntrySteadyOrFetching: function (op) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      var id = idForOp(op); // If we're already fetching this one, or about to, we can't optimize;
      // make sure that we fetch it again if necessary.

      if (self._phase === PHASE.FETCHING && (self._currentlyFetching && self._currentlyFetching.has(id) || self._needToFetch.has(id))) {
        self._needToFetch.set(id, op.ts.toString());

        return;
      }

      if (op.op === 'd') {
        if (self._published.has(id) || self._limit && self._unpublishedBuffer.has(id)) self._removeMatching(id);
      } else if (op.op === 'i') {
        if (self._published.has(id)) throw new Error("insert found for already-existing ID in published");
        if (self._unpublishedBuffer && self._unpublishedBuffer.has(id)) throw new Error("insert found for already-existing ID in buffer"); // XXX what if selector yields?  for now it can't but later it could
        // have $where

        if (self._matcher.documentMatches(op.o).result) self._addMatching(op.o);
      } else if (op.op === 'u') {
        // Is this a modifier ($set/$unset, which may require us to poll the
        // database to figure out if the whole document matches the selector) or
        // a replacement (in which case we can just directly re-evaluate the
        // selector)?
        var isReplace = !_.has(op.o, '$set') && !_.has(op.o, '$unset'); // If this modifier modifies something inside an EJSON custom type (ie,
        // anything with EJSON$), then we can't try to use
        // LocalCollection._modify, since that just mutates the EJSON encoding,
        // not the actual object.

        var canDirectlyModifyDoc = !isReplace && modifierCanBeDirectlyApplied(op.o);

        var publishedBefore = self._published.has(id);

        var bufferedBefore = self._limit && self._unpublishedBuffer.has(id);

        if (isReplace) {
          self._handleDoc(id, _.extend({
            _id: id
          }, op.o));
        } else if ((publishedBefore || bufferedBefore) && canDirectlyModifyDoc) {
          // Oh great, we actually know what the document is, so we can apply
          // this directly.
          var newDoc = self._published.has(id) ? self._published.get(id) : self._unpublishedBuffer.get(id);
          newDoc = EJSON.clone(newDoc);
          newDoc._id = id;

          try {
            LocalCollection._modify(newDoc, op.o);
          } catch (e) {
            if (e.name !== "MinimongoError") throw e; // We didn't understand the modifier.  Re-fetch.

            self._needToFetch.set(id, op.ts.toString());

            if (self._phase === PHASE.STEADY) {
              self._fetchModifiedDocuments();
            }

            return;
          }

          self._handleDoc(id, self._sharedProjectionFn(newDoc));
        } else if (!canDirectlyModifyDoc || self._matcher.canBecomeTrueByModifier(op.o) || self._sorter && self._sorter.affectedByModifier(op.o)) {
          self._needToFetch.set(id, op.ts.toString());

          if (self._phase === PHASE.STEADY) self._fetchModifiedDocuments();
        }
      } else {
        throw Error("XXX SURPRISING OPERATION: " + op);
      }
    });
  },
  // Yields!
  _runInitialQuery: function () {
    var self = this;
    if (self._stopped) throw new Error("oplog stopped surprisingly early");

    self._runQuery({
      initial: true
    }); // yields


    if (self._stopped) return; // can happen on queryError
    // Allow observeChanges calls to return. (After this, it's possible for
    // stop() to be called.)

    self._multiplexer.ready();

    self._doneQuerying(); // yields

  },
  // In various circumstances, we may just want to stop processing the oplog and
  // re-run the initial query, just as if we were a PollingObserveDriver.
  //
  // This function may not block, because it is called from an oplog entry
  // handler.
  //
  // XXX We should call this when we detect that we've been in FETCHING for "too
  // long".
  //
  // XXX We should call this when we detect Mongo failover (since that might
  // mean that some of the oplog entries we have processed have been rolled
  // back). The Node Mongo driver is in the middle of a bunch of huge
  // refactorings, including the way that it notifies you when primary
  // changes. Will put off implementing this until driver 1.4 is out.
  _pollQuery: function () {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      if (self._stopped) return; // Yay, we get to forget about all the things we thought we had to fetch.

      self._needToFetch = new LocalCollection._IdMap();
      self._currentlyFetching = null;
      ++self._fetchGeneration; // ignore any in-flight fetches

      self._registerPhaseChange(PHASE.QUERYING); // Defer so that we don't yield.  We don't need finishIfNeedToPollQuery
      // here because SwitchedToQuery is not thrown in QUERYING mode.


      Meteor.defer(function () {
        self._runQuery();

        self._doneQuerying();
      });
    });
  },
  // Yields!
  _runQuery: function (options) {
    var self = this;
    options = options || {};
    var newResults, newBuffer; // This while loop is just to retry failures.

    while (true) {
      // If we've been stopped, we don't have to run anything any more.
      if (self._stopped) return;
      newResults = new LocalCollection._IdMap();
      newBuffer = new LocalCollection._IdMap(); // Query 2x documents as the half excluded from the original query will go
      // into unpublished buffer to reduce additional Mongo lookups in cases
      // when documents are removed from the published set and need a
      // replacement.
      // XXX needs more thought on non-zero skip
      // XXX 2 is a "magic number" meaning there is an extra chunk of docs for
      // buffer if such is needed.

      var cursor = self._cursorForQuery({
        limit: self._limit * 2
      });

      try {
        cursor.forEach(function (doc, i) {
          // yields
          if (!self._limit || i < self._limit) {
            newResults.set(doc._id, doc);
          } else {
            newBuffer.set(doc._id, doc);
          }
        });
        break;
      } catch (e) {
        if (options.initial && typeof e.code === 'number') {
          // This is an error document sent to us by mongod, not a connection
          // error generated by the client. And we've never seen this query work
          // successfully. Probably it's a bad selector or something, so we
          // should NOT retry. Instead, we should halt the observe (which ends
          // up calling `stop` on us).
          self._multiplexer.queryError(e);

          return;
        } // During failover (eg) if we get an exception we should log and retry
        // instead of crashing.


        Meteor._debug("Got exception while polling query: " + e);

        Meteor._sleepForMs(100);
      }
    }

    if (self._stopped) return;

    self._publishNewResults(newResults, newBuffer);
  },
  // Transitions to QUERYING and runs another query, or (if already in QUERYING)
  // ensures that we will query again later.
  //
  // This function may not block, because it is called from an oplog entry
  // handler. However, if we were not already in the QUERYING phase, it throws
  // an exception that is caught by the closest surrounding
  // finishIfNeedToPollQuery call; this ensures that we don't continue running
  // close that was designed for another phase inside PHASE.QUERYING.
  //
  // (It's also necessary whenever logic in this file yields to check that other
  // phases haven't put us into QUERYING mode, though; eg,
  // _fetchModifiedDocuments does this.)
  _needToPollQuery: function () {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      if (self._stopped) return; // If we're not already in the middle of a query, we can query now
      // (possibly pausing FETCHING).

      if (self._phase !== PHASE.QUERYING) {
        self._pollQuery();

        throw new SwitchedToQuery();
      } // We're currently in QUERYING. Set a flag to ensure that we run another
      // query when we're done.


      self._requeryWhenDoneThisQuery = true;
    });
  },
  // Yields!
  _doneQuerying: function () {
    var self = this;
    if (self._stopped) return;

    self._mongoHandle._oplogHandle.waitUntilCaughtUp(); // yields


    if (self._stopped) return;
    if (self._phase !== PHASE.QUERYING) throw Error("Phase unexpectedly " + self._phase);

    Meteor._noYieldsAllowed(function () {
      if (self._requeryWhenDoneThisQuery) {
        self._requeryWhenDoneThisQuery = false;

        self._pollQuery();
      } else if (self._needToFetch.empty()) {
        self._beSteady();
      } else {
        self._fetchModifiedDocuments();
      }
    });
  },
  _cursorForQuery: function (optionsOverwrite) {
    var self = this;
    return Meteor._noYieldsAllowed(function () {
      // The query we run is almost the same as the cursor we are observing,
      // with a few changes. We need to read all the fields that are relevant to
      // the selector, not just the fields we are going to publish (that's the
      // "shared" projection). And we don't want to apply any transform in the
      // cursor, because observeChanges shouldn't use the transform.
      var options = _.clone(self._cursorDescription.options); // Allow the caller to modify the options. Useful to specify different
      // skip and limit values.


      _.extend(options, optionsOverwrite);

      options.fields = self._sharedProjection;
      delete options.transform; // We are NOT deep cloning fields or selector here, which should be OK.

      var description = new CursorDescription(self._cursorDescription.collectionName, self._cursorDescription.selector, options);
      return new Cursor(self._mongoHandle, description);
    });
  },
  // Replace self._published with newResults (both are IdMaps), invoking observe
  // callbacks on the multiplexer.
  // Replace self._unpublishedBuffer with newBuffer.
  //
  // XXX This is very similar to LocalCollection._diffQueryUnorderedChanges. We
  // should really: (a) Unify IdMap and OrderedDict into Unordered/OrderedDict
  // (b) Rewrite diff.js to use these classes instead of arrays and objects.
  _publishNewResults: function (newResults, newBuffer) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      // If the query is limited and there is a buffer, shut down so it doesn't
      // stay in a way.
      if (self._limit) {
        self._unpublishedBuffer.clear();
      } // First remove anything that's gone. Be careful not to modify
      // self._published while iterating over it.


      var idsToRemove = [];

      self._published.forEach(function (doc, id) {
        if (!newResults.has(id)) idsToRemove.push(id);
      });

      _.each(idsToRemove, function (id) {
        self._removePublished(id);
      }); // Now do adds and changes.
      // If self has a buffer and limit, the new fetched result will be
      // limited correctly as the query has sort specifier.


      newResults.forEach(function (doc, id) {
        self._handleDoc(id, doc);
      }); // Sanity-check that everything we tried to put into _published ended up
      // there.
      // XXX if this is slow, remove it later

      if (self._published.size() !== newResults.size()) {
        throw Error("The Mongo server and the Meteor query disagree on how " + "many documents match your query. Maybe it is hitting a Mongo " + "edge case? The query is: " + EJSON.stringify(self._cursorDescription.selector));
      }

      self._published.forEach(function (doc, id) {
        if (!newResults.has(id)) throw Error("_published has a doc that newResults doesn't; " + id);
      }); // Finally, replace the buffer


      newBuffer.forEach(function (doc, id) {
        self._addBuffered(id, doc);
      });
      self._safeAppendToBuffer = newBuffer.size() < self._limit;
    });
  },
  // This stop function is invoked from the onStop of the ObserveMultiplexer, so
  // it shouldn't actually be possible to call it until the multiplexer is
  // ready.
  //
  // It's important to check self._stopped after every call in this file that
  // can yield!
  stop: function () {
    var self = this;
    if (self._stopped) return;
    self._stopped = true;

    _.each(self._stopHandles, function (handle) {
      handle.stop();
    }); // Note: we *don't* use multiplexer.onFlush here because this stop
    // callback is actually invoked by the multiplexer itself when it has
    // determined that there are no handles left. So nothing is actually going
    // to get flushed (and it's probably not valid to call methods on the
    // dying multiplexer).


    _.each(self._writesToCommitWhenWeReachSteady, function (w) {
      w.committed(); // maybe yields?
    });

    self._writesToCommitWhenWeReachSteady = null; // Proactively drop references to potentially big things.

    self._published = null;
    self._unpublishedBuffer = null;
    self._needToFetch = null;
    self._currentlyFetching = null;
    self._oplogEntryHandle = null;
    self._listenersHandle = null;
    Package.facts && Package.facts.Facts.incrementServerFact("mongo-livedata", "observe-drivers-oplog", -1);
  },
  _registerPhaseChange: function (phase) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      var now = new Date();

      if (self._phase) {
        var timeDiff = now - self._phaseStartTime;
        Package.facts && Package.facts.Facts.incrementServerFact("mongo-livedata", "time-spent-in-" + self._phase + "-phase", timeDiff);
      }

      self._phase = phase;
      self._phaseStartTime = now;
    });
  }
}); // Does our oplog tailing code support this cursor? For now, we are being very
// conservative and allowing only simple queries with simple options.
// (This is a "static method".)


OplogObserveDriver.cursorSupported = function (cursorDescription, matcher) {
  // First, check the options.
  var options = cursorDescription.options; // Did the user say no explicitly?
  // underscored version of the option is COMPAT with 1.2

  if (options.disableOplog || options._disableOplog) return false; // skip is not supported: to support it we would need to keep track of all
  // "skipped" documents or at least their ids.
  // limit w/o a sort specifier is not supported: current implementation needs a
  // deterministic way to order documents.

  if (options.skip || options.limit && !options.sort) return false; // If a fields projection option is given check if it is supported by
  // minimongo (some operators are not supported).

  if (options.fields) {
    try {
      LocalCollection._checkSupportedProjection(options.fields);
    } catch (e) {
      if (e.name === "MinimongoError") {
        return false;
      } else {
        throw e;
      }
    }
  } // We don't allow the following selectors:
  //   - $where (not confident that we provide the same JS environment
  //             as Mongo, and can yield!)
  //   - $near (has "interesting" properties in MongoDB, like the possibility
  //            of returning an ID multiple times, though even polling maybe
  //            have a bug there)
  //           XXX: once we support it, we would need to think more on how we
  //           initialize the comparators when we create the driver.


  return !matcher.hasWhere() && !matcher.hasGeoQuery();
};

var modifierCanBeDirectlyApplied = function (modifier) {
  return _.all(modifier, function (fields, operation) {
    return _.all(fields, function (value, field) {
      return !/EJSON\$/.test(field);
    });
  });
};

MongoInternals.OplogObserveDriver = OplogObserveDriver;
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"local_collection_driver.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/local_collection_driver.js                                                                           //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  LocalCollectionDriver: () => LocalCollectionDriver
});
const LocalCollectionDriver = new class LocalCollectionDriver {
  constructor() {
    this.noConnCollections = Object.create(null);
  }

  open(name, conn) {
    if (!name) {
      return new LocalCollection();
    }

    if (!conn) {
      return ensureCollection(name, this.noConnCollections);
    }

    if (!conn._mongo_livedata_collections) {
      conn._mongo_livedata_collections = Object.create(null);
    } // XXX is there a way to keep track of a connection's collections without
    // dangling it off the connection object?


    return ensureCollection(name, conn._mongo_livedata_collections);
  }

}();

function ensureCollection(name, collections) {
  return name in collections ? collections[name] : collections[name] = new LocalCollection(name);
}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"remote_collection_driver.js":function(require){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/remote_collection_driver.js                                                                          //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
MongoInternals.RemoteCollectionDriver = function (mongo_url, options) {
  var self = this;
  self.mongo = new MongoConnection(mongo_url, options);
};

_.extend(MongoInternals.RemoteCollectionDriver.prototype, {
  open: function (name) {
    var self = this;
    var ret = {};

    _.each(['find', 'findOne', 'insert', 'update', 'upsert', 'remove', '_ensureIndex', '_dropIndex', '_createCappedCollection', 'dropCollection', 'rawCollection'], function (m) {
      ret[m] = _.bind(self.mongo[m], self.mongo, name);
    });

    return ret;
  }
}); // Create the singleton RemoteCollectionDriver only on demand, so we
// only require Mongo configuration if it's actually used (eg, not if
// you're only trying to receive data from a remote DDP server.)


MongoInternals.defaultRemoteCollectionDriver = _.once(function () {
  var connectionOptions = {};
  var mongoUrl = process.env.MONGO_URL;

  if (process.env.MONGO_OPLOG_URL) {
    connectionOptions.oplogUrl = process.env.MONGO_OPLOG_URL;
  }

  if (!mongoUrl) throw new Error("MONGO_URL must be set in environment");
  return new MongoInternals.RemoteCollectionDriver(mongoUrl, connectionOptions);
});
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"collection.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/collection.js                                                                                        //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
var _interopRequireDefault = require("@babel/runtime/helpers/builtin/interopRequireDefault");

var _objectSpread2 = _interopRequireDefault(require("@babel/runtime/helpers/builtin/objectSpread"));

// options.connection, if given, is a LivedataClient or LivedataServer
// XXX presently there is no way to destroy/clean up a Collection

/**
 * @summary Namespace for MongoDB-related items
 * @namespace
 */
Mongo = {};
/**
 * @summary Constructor for a Collection
 * @locus Anywhere
 * @instancename collection
 * @class
 * @param {String} name The name of the collection.  If null, creates an unmanaged (unsynchronized) local collection.
 * @param {Object} [options]
 * @param {Object} options.connection The server connection that will manage this collection. Uses the default connection if not specified.  Pass the return value of calling [`DDP.connect`](#ddp_connect) to specify a different server. Pass `null` to specify no connection. Unmanaged (`name` is null) collections cannot specify a connection.
 * @param {String} options.idGeneration The method of generating the `_id` fields of new documents in this collection.  Possible values:

 - **`'STRING'`**: random strings
 - **`'MONGO'`**:  random [`Mongo.ObjectID`](#mongo_object_id) values

The default id generation technique is `'STRING'`.
 * @param {Function} options.transform An optional transformation function. Documents will be passed through this function before being returned from `fetch` or `findOne`, and before being passed to callbacks of `observe`, `map`, `forEach`, `allow`, and `deny`. Transforms are *not* applied for the callbacks of `observeChanges` or to cursors returned from publish functions.
 * @param {Boolean} options.defineMutationMethods Set to `false` to skip setting up the mutation methods that enable insert/update/remove from client code. Default `true`.
 */

Mongo.Collection = function Collection(name, options) {
  if (!name && name !== null) {
    Meteor._debug("Warning: creating anonymous collection. It will not be " + "saved or synchronized over the network. (Pass null for " + "the collection name to turn off this warning.)");

    name = null;
  }

  if (name !== null && typeof name !== "string") {
    throw new Error("First argument to new Mongo.Collection must be a string or null");
  }

  if (options && options.methods) {
    // Backwards compatibility hack with original signature (which passed
    // "connection" directly instead of in options. (Connections must have a "methods"
    // method.)
    // XXX remove before 1.0
    options = {
      connection: options
    };
  } // Backwards compatibility: "connection" used to be called "manager".


  if (options && options.manager && !options.connection) {
    options.connection = options.manager;
  }

  options = (0, _objectSpread2.default)({
    connection: undefined,
    idGeneration: 'STRING',
    transform: null,
    _driver: undefined,
    _preventAutopublish: false
  }, options);

  switch (options.idGeneration) {
    case 'MONGO':
      this._makeNewID = function () {
        var src = name ? DDP.randomStream('/collection/' + name) : Random.insecure;
        return new Mongo.ObjectID(src.hexString(24));
      };

      break;

    case 'STRING':
    default:
      this._makeNewID = function () {
        var src = name ? DDP.randomStream('/collection/' + name) : Random.insecure;
        return src.id();
      };

      break;
  }

  this._transform = LocalCollection.wrapTransform(options.transform);
  if (!name || options.connection === null) // note: nameless collections never have a connection
    this._connection = null;else if (options.connection) this._connection = options.connection;else if (Meteor.isClient) this._connection = Meteor.connection;else this._connection = Meteor.server;

  if (!options._driver) {
    // XXX This check assumes that webapp is loaded so that Meteor.server !==
    // null. We should fully support the case of "want to use a Mongo-backed
    // collection from Node code without webapp", but we don't yet.
    // #MeteorServerNull
    if (name && this._connection === Meteor.server && typeof MongoInternals !== "undefined" && MongoInternals.defaultRemoteCollectionDriver) {
      options._driver = MongoInternals.defaultRemoteCollectionDriver();
    } else {
      const {
        LocalCollectionDriver
      } = require("./local_collection_driver.js");

      options._driver = LocalCollectionDriver;
    }
  }

  this._collection = options._driver.open(name, this._connection);
  this._name = name;
  this._driver = options._driver;

  this._maybeSetUpReplication(name, options); // XXX don't define these until allow or deny is actually used for this
  // collection. Could be hard if the security rules are only defined on the
  // server.


  if (options.defineMutationMethods !== false) {
    try {
      this._defineMutationMethods({
        useExisting: options._suppressSameNameError === true
      });
    } catch (error) {
      // Throw a more understandable error on the server for same collection name
      if (error.message === `A method named '/${name}/insert' is already defined`) throw new Error(`There is already a collection named "${name}"`);
      throw error;
    }
  } // autopublish


  if (Package.autopublish && !options._preventAutopublish && this._connection && this._connection.publish) {
    this._connection.publish(null, () => this.find(), {
      is_auto: true
    });
  }
};

Object.assign(Mongo.Collection.prototype, {
  _maybeSetUpReplication(name, {
    _suppressSameNameError = false
  }) {
    const self = this;

    if (!(self._connection && self._connection.registerStore)) {
      return;
    } // OK, we're going to be a slave, replicating some remote
    // database, except possibly with some temporary divergence while
    // we have unacknowledged RPC's.


    const ok = self._connection.registerStore(name, {
      // Called at the beginning of a batch of updates. batchSize is the number
      // of update calls to expect.
      //
      // XXX This interface is pretty janky. reset probably ought to go back to
      // being its own function, and callers shouldn't have to calculate
      // batchSize. The optimization of not calling pause/remove should be
      // delayed until later: the first call to update() should buffer its
      // message, and then we can either directly apply it at endUpdate time if
      // it was the only update, or do pauseObservers/apply/apply at the next
      // update() if there's another one.
      beginUpdate(batchSize, reset) {
        // pause observers so users don't see flicker when updating several
        // objects at once (including the post-reconnect reset-and-reapply
        // stage), and so that a re-sorting of a query can take advantage of the
        // full _diffQuery moved calculation instead of applying change one at a
        // time.
        if (batchSize > 1 || reset) self._collection.pauseObservers();
        if (reset) self._collection.remove({});
      },

      // Apply an update.
      // XXX better specify this interface (not in terms of a wire message)?
      update(msg) {
        var mongoId = MongoID.idParse(msg.id);

        var doc = self._collection.findOne(mongoId); // Is this a "replace the whole doc" message coming from the quiescence
        // of method writes to an object? (Note that 'undefined' is a valid
        // value meaning "remove it".)


        if (msg.msg === 'replace') {
          var replace = msg.replace;

          if (!replace) {
            if (doc) self._collection.remove(mongoId);
          } else if (!doc) {
            self._collection.insert(replace);
          } else {
            // XXX check that replace has no $ ops
            self._collection.update(mongoId, replace);
          }

          return;
        } else if (msg.msg === 'added') {
          if (doc) {
            throw new Error("Expected not to find a document already present for an add");
          }

          self._collection.insert((0, _objectSpread2.default)({
            _id: mongoId
          }, msg.fields));
        } else if (msg.msg === 'removed') {
          if (!doc) throw new Error("Expected to find a document already present for removed");

          self._collection.remove(mongoId);
        } else if (msg.msg === 'changed') {
          if (!doc) throw new Error("Expected to find a document to change");
          const keys = Object.keys(msg.fields);

          if (keys.length > 0) {
            var modifier = {};
            keys.forEach(key => {
              const value = msg.fields[key];

              if (typeof value === "undefined") {
                if (!modifier.$unset) {
                  modifier.$unset = {};
                }

                modifier.$unset[key] = 1;
              } else {
                if (!modifier.$set) {
                  modifier.$set = {};
                }

                modifier.$set[key] = value;
              }
            });

            self._collection.update(mongoId, modifier);
          }
        } else {
          throw new Error("I don't know how to deal with this message");
        }
      },

      // Called at the end of a batch of updates.
      endUpdate() {
        self._collection.resumeObservers();
      },

      // Called around method stub invocations to capture the original versions
      // of modified documents.
      saveOriginals() {
        self._collection.saveOriginals();
      },

      retrieveOriginals() {
        return self._collection.retrieveOriginals();
      },

      // Used to preserve current versions of documents across a store reset.
      getDoc(id) {
        return self.findOne(id);
      },

      // To be able to get back to the collection from the store.
      _getCollection() {
        return self;
      }

    });

    if (!ok) {
      const message = `There is already a collection named "${name}"`;

      if (_suppressSameNameError === true) {
        // XXX In theory we do not have to throw when `ok` is falsy. The
        // store is already defined for this collection name, but this
        // will simply be another reference to it and everything should
        // work. However, we have historically thrown an error here, so
        // for now we will skip the error only when _suppressSameNameError
        // is `true`, allowing people to opt in and give this some real
        // world testing.
        console.warn ? console.warn(message) : console.log(message);
      } else {
        throw new Error(message);
      }
    }
  },

  ///
  /// Main collection API
  ///
  _getFindSelector(args) {
    if (args.length == 0) return {};else return args[0];
  },

  _getFindOptions(args) {
    var self = this;

    if (args.length < 2) {
      return {
        transform: self._transform
      };
    } else {
      check(args[1], Match.Optional(Match.ObjectIncluding({
        fields: Match.Optional(Match.OneOf(Object, undefined)),
        sort: Match.Optional(Match.OneOf(Object, Array, Function, undefined)),
        limit: Match.Optional(Match.OneOf(Number, undefined)),
        skip: Match.Optional(Match.OneOf(Number, undefined))
      })));
      return (0, _objectSpread2.default)({
        transform: self._transform
      }, args[1]);
    }
  },

  /**
   * @summary Find the documents in a collection that match the selector.
   * @locus Anywhere
   * @method find
   * @memberOf Mongo.Collection
   * @instance
   * @param {MongoSelector} [selector] A query describing the documents to find
   * @param {Object} [options]
   * @param {MongoSortSpecifier} options.sort Sort order (default: natural order)
   * @param {Number} options.skip Number of results to skip at the beginning
   * @param {Number} options.limit Maximum number of results to return
   * @param {MongoFieldSpecifier} options.fields Dictionary of fields to return or exclude.
   * @param {Boolean} options.reactive (Client only) Default `true`; pass `false` to disable reactivity
   * @param {Function} options.transform Overrides `transform` on the  [`Collection`](#collections) for this cursor.  Pass `null` to disable transformation.
   * @param {Boolean} options.disableOplog (Server only) Pass true to disable oplog-tailing on this query. This affects the way server processes calls to `observe` on this query. Disabling the oplog can be useful when working with data that updates in large batches.
   * @param {Number} options.pollingIntervalMs (Server only) When oplog is disabled (through the use of `disableOplog` or when otherwise not available), the frequency (in milliseconds) of how often to poll this query when observing on the server. Defaults to 10000ms (10 seconds).
   * @param {Number} options.pollingThrottleMs (Server only) When oplog is disabled (through the use of `disableOplog` or when otherwise not available), the minimum time (in milliseconds) to allow between re-polling when observing on the server. Increasing this will save CPU and mongo load at the expense of slower updates to users. Decreasing this is not recommended. Defaults to 50ms.
   * @param {Number} options.maxTimeMs (Server only) If set, instructs MongoDB to set a time limit for this cursor's operations. If the operation reaches the specified time limit (in milliseconds) without the having been completed, an exception will be thrown. Useful to prevent an (accidental or malicious) unoptimized query from causing a full collection scan that would disrupt other database users, at the expense of needing to handle the resulting error.
   * @param {String|Object} options.hint (Server only) Overrides MongoDB's default index selection and query optimization process. Specify an index to force its use, either by its name or index specification. You can also specify `{ $natural : 1 }` to force a forwards collection scan, or `{ $natural : -1 }` for a reverse collection scan. Setting this is only recommended for advanced users.
   * @returns {Mongo.Cursor}
   */
  find(...args) {
    // Collection.find() (return all docs) behaves differently
    // from Collection.find(undefined) (return 0 docs).  so be
    // careful about the length of arguments.
    return this._collection.find(this._getFindSelector(args), this._getFindOptions(args));
  },

  /**
   * @summary Finds the first document that matches the selector, as ordered by sort and skip options. Returns `undefined` if no matching document is found.
   * @locus Anywhere
   * @method findOne
   * @memberOf Mongo.Collection
   * @instance
   * @param {MongoSelector} [selector] A query describing the documents to find
   * @param {Object} [options]
   * @param {MongoSortSpecifier} options.sort Sort order (default: natural order)
   * @param {Number} options.skip Number of results to skip at the beginning
   * @param {MongoFieldSpecifier} options.fields Dictionary of fields to return or exclude.
   * @param {Boolean} options.reactive (Client only) Default true; pass false to disable reactivity
   * @param {Function} options.transform Overrides `transform` on the [`Collection`](#collections) for this cursor.  Pass `null` to disable transformation.
   * @returns {Object}
   */
  findOne(...args) {
    return this._collection.findOne(this._getFindSelector(args), this._getFindOptions(args));
  }

});
Object.assign(Mongo.Collection, {
  _publishCursor(cursor, sub, collection) {
    var observeHandle = cursor.observeChanges({
      added: function (id, fields) {
        sub.added(collection, id, fields);
      },
      changed: function (id, fields) {
        sub.changed(collection, id, fields);
      },
      removed: function (id) {
        sub.removed(collection, id);
      }
    }); // We don't call sub.ready() here: it gets called in livedata_server, after
    // possibly calling _publishCursor on multiple returned cursors.
    // register stop callback (expects lambda w/ no args).

    sub.onStop(function () {
      observeHandle.stop();
    }); // return the observeHandle in case it needs to be stopped early

    return observeHandle;
  },

  // protect against dangerous selectors.  falsey and {_id: falsey} are both
  // likely programmer error, and not what you want, particularly for destructive
  // operations. If a falsey _id is sent in, a new string _id will be
  // generated and returned; if a fallbackId is provided, it will be returned
  // instead.
  _rewriteSelector(selector, {
    fallbackId
  } = {}) {
    // shorthand -- scalars match _id
    if (LocalCollection._selectorIsId(selector)) selector = {
      _id: selector
    };

    if (Array.isArray(selector)) {
      // This is consistent with the Mongo console itself; if we don't do this
      // check passing an empty array ends up selecting all items
      throw new Error("Mongo selector can't be an array.");
    }

    if (!selector || '_id' in selector && !selector._id) {
      // can't match anything
      return {
        _id: fallbackId || Random.id()
      };
    }

    return selector;
  }

});
Object.assign(Mongo.Collection.prototype, {
  // 'insert' immediately returns the inserted document's new _id.
  // The others return values immediately if you are in a stub, an in-memory
  // unmanaged collection, or a mongo-backed collection and you don't pass a
  // callback. 'update' and 'remove' return the number of affected
  // documents. 'upsert' returns an object with keys 'numberAffected' and, if an
  // insert happened, 'insertedId'.
  //
  // Otherwise, the semantics are exactly like other methods: they take
  // a callback as an optional last argument; if no callback is
  // provided, they block until the operation is complete, and throw an
  // exception if it fails; if a callback is provided, then they don't
  // necessarily block, and they call the callback when they finish with error and
  // result arguments.  (The insert method provides the document ID as its result;
  // update and remove provide the number of affected docs as the result; upsert
  // provides an object with numberAffected and maybe insertedId.)
  //
  // On the client, blocking is impossible, so if a callback
  // isn't provided, they just return immediately and any error
  // information is lost.
  //
  // There's one more tweak. On the client, if you don't provide a
  // callback, then if there is an error, a message will be logged with
  // Meteor._debug.
  //
  // The intent (though this is actually determined by the underlying
  // drivers) is that the operations should be done synchronously, not
  // generating their result until the database has acknowledged
  // them. In the future maybe we should provide a flag to turn this
  // off.

  /**
   * @summary Insert a document in the collection.  Returns its unique _id.
   * @locus Anywhere
   * @method  insert
   * @memberOf Mongo.Collection
   * @instance
   * @param {Object} doc The document to insert. May not yet have an _id attribute, in which case Meteor will generate one for you.
   * @param {Function} [callback] Optional.  If present, called with an error object as the first argument and, if no error, the _id as the second.
   */
  insert(doc, callback) {
    // Make sure we were passed a document to insert
    if (!doc) {
      throw new Error("insert requires an argument");
    } // Make a shallow clone of the document, preserving its prototype.


    doc = Object.create(Object.getPrototypeOf(doc), Object.getOwnPropertyDescriptors(doc));

    if ('_id' in doc) {
      if (!doc._id || !(typeof doc._id === 'string' || doc._id instanceof Mongo.ObjectID)) {
        throw new Error("Meteor requires document _id fields to be non-empty strings or ObjectIDs");
      }
    } else {
      let generateId = true; // Don't generate the id if we're the client and the 'outermost' call
      // This optimization saves us passing both the randomSeed and the id
      // Passing both is redundant.

      if (this._isRemoteCollection()) {
        const enclosing = DDP._CurrentMethodInvocation.get();

        if (!enclosing) {
          generateId = false;
        }
      }

      if (generateId) {
        doc._id = this._makeNewID();
      }
    } // On inserts, always return the id that we generated; on all other
    // operations, just return the result from the collection.


    var chooseReturnValueFromCollectionResult = function (result) {
      if (doc._id) {
        return doc._id;
      } // XXX what is this for??
      // It's some iteraction between the callback to _callMutatorMethod and
      // the return value conversion


      doc._id = result;
      return result;
    };

    const wrappedCallback = wrapCallback(callback, chooseReturnValueFromCollectionResult);

    if (this._isRemoteCollection()) {
      const result = this._callMutatorMethod("insert", [doc], wrappedCallback);

      return chooseReturnValueFromCollectionResult(result);
    } // it's my collection.  descend into the collection object
    // and propagate any exception.


    try {
      // If the user provided a callback and the collection implements this
      // operation asynchronously, then queryRet will be undefined, and the
      // result will be returned through the callback instead.
      const result = this._collection.insert(doc, wrappedCallback);

      return chooseReturnValueFromCollectionResult(result);
    } catch (e) {
      if (callback) {
        callback(e);
        return null;
      }

      throw e;
    }
  },

  /**
   * @summary Modify one or more documents in the collection. Returns the number of matched documents.
   * @locus Anywhere
   * @method update
   * @memberOf Mongo.Collection
   * @instance
   * @param {MongoSelector} selector Specifies which documents to modify
   * @param {MongoModifier} modifier Specifies how to modify the documents
   * @param {Object} [options]
   * @param {Boolean} options.multi True to modify all matching documents; false to only modify one of the matching documents (the default).
   * @param {Boolean} options.upsert True to insert a document if no matching documents are found.
   * @param {Function} [callback] Optional.  If present, called with an error object as the first argument and, if no error, the number of affected documents as the second.
   */
  update(selector, modifier, ...optionsAndCallback) {
    const callback = popCallbackFromArgs(optionsAndCallback); // We've already popped off the callback, so we are left with an array
    // of one or zero items

    const options = (0, _objectSpread2.default)({}, optionsAndCallback[0] || null);
    let insertedId;

    if (options && options.upsert) {
      // set `insertedId` if absent.  `insertedId` is a Meteor extension.
      if (options.insertedId) {
        if (!(typeof options.insertedId === 'string' || options.insertedId instanceof Mongo.ObjectID)) throw new Error("insertedId must be string or ObjectID");
        insertedId = options.insertedId;
      } else if (!selector || !selector._id) {
        insertedId = this._makeNewID();
        options.generatedId = true;
        options.insertedId = insertedId;
      }
    }

    selector = Mongo.Collection._rewriteSelector(selector, {
      fallbackId: insertedId
    });
    const wrappedCallback = wrapCallback(callback);

    if (this._isRemoteCollection()) {
      const args = [selector, modifier, options];
      return this._callMutatorMethod("update", args, wrappedCallback);
    } // it's my collection.  descend into the collection object
    // and propagate any exception.


    try {
      // If the user provided a callback and the collection implements this
      // operation asynchronously, then queryRet will be undefined, and the
      // result will be returned through the callback instead.
      return this._collection.update(selector, modifier, options, wrappedCallback);
    } catch (e) {
      if (callback) {
        callback(e);
        return null;
      }

      throw e;
    }
  },

  /**
   * @summary Remove documents from the collection
   * @locus Anywhere
   * @method remove
   * @memberOf Mongo.Collection
   * @instance
   * @param {MongoSelector} selector Specifies which documents to remove
   * @param {Function} [callback] Optional.  If present, called with an error object as its argument.
   */
  remove(selector, callback) {
    selector = Mongo.Collection._rewriteSelector(selector);
    const wrappedCallback = wrapCallback(callback);

    if (this._isRemoteCollection()) {
      return this._callMutatorMethod("remove", [selector], wrappedCallback);
    } // it's my collection.  descend into the collection object
    // and propagate any exception.


    try {
      // If the user provided a callback and the collection implements this
      // operation asynchronously, then queryRet will be undefined, and the
      // result will be returned through the callback instead.
      return this._collection.remove(selector, wrappedCallback);
    } catch (e) {
      if (callback) {
        callback(e);
        return null;
      }

      throw e;
    }
  },

  // Determine if this collection is simply a minimongo representation of a real
  // database on another server
  _isRemoteCollection() {
    // XXX see #MeteorServerNull
    return this._connection && this._connection !== Meteor.server;
  },

  /**
   * @summary Modify one or more documents in the collection, or insert one if no matching documents were found. Returns an object with keys `numberAffected` (the number of documents modified)  and `insertedId` (the unique _id of the document that was inserted, if any).
   * @locus Anywhere
   * @param {MongoSelector} selector Specifies which documents to modify
   * @param {MongoModifier} modifier Specifies how to modify the documents
   * @param {Object} [options]
   * @param {Boolean} options.multi True to modify all matching documents; false to only modify one of the matching documents (the default).
   * @param {Function} [callback] Optional.  If present, called with an error object as the first argument and, if no error, the number of affected documents as the second.
   */
  upsert(selector, modifier, options, callback) {
    if (!callback && typeof options === "function") {
      callback = options;
      options = {};
    }

    return this.update(selector, modifier, (0, _objectSpread2.default)({}, options, {
      _returnObject: true,
      upsert: true
    }), callback);
  },

  // We'll actually design an index API later. For now, we just pass through to
  // Mongo's, but make it synchronous.
  _ensureIndex(index, options) {
    var self = this;
    if (!self._collection._ensureIndex) throw new Error("Can only call _ensureIndex on server collections");

    self._collection._ensureIndex(index, options);
  },

  _dropIndex(index) {
    var self = this;
    if (!self._collection._dropIndex) throw new Error("Can only call _dropIndex on server collections");

    self._collection._dropIndex(index);
  },

  _dropCollection() {
    var self = this;
    if (!self._collection.dropCollection) throw new Error("Can only call _dropCollection on server collections");

    self._collection.dropCollection();
  },

  _createCappedCollection(byteSize, maxDocuments) {
    var self = this;
    if (!self._collection._createCappedCollection) throw new Error("Can only call _createCappedCollection on server collections");

    self._collection._createCappedCollection(byteSize, maxDocuments);
  },

  /**
   * @summary Returns the [`Collection`](http://mongodb.github.io/node-mongodb-native/2.2/api/Collection.html) object corresponding to this collection from the [npm `mongodb` driver module](https://www.npmjs.com/package/mongodb) which is wrapped by `Mongo.Collection`.
   * @locus Server
   */
  rawCollection() {
    var self = this;

    if (!self._collection.rawCollection) {
      throw new Error("Can only call rawCollection on server collections");
    }

    return self._collection.rawCollection();
  },

  /**
   * @summary Returns the [`Db`](http://mongodb.github.io/node-mongodb-native/2.2/api/Db.html) object corresponding to this collection's database connection from the [npm `mongodb` driver module](https://www.npmjs.com/package/mongodb) which is wrapped by `Mongo.Collection`.
   * @locus Server
   */
  rawDatabase() {
    var self = this;

    if (!(self._driver.mongo && self._driver.mongo.db)) {
      throw new Error("Can only call rawDatabase on server collections");
    }

    return self._driver.mongo.db;
  }

}); // Convert the callback to not return a result if there is an error

function wrapCallback(callback, convertResult) {
  return callback && function (error, result) {
    if (error) {
      callback(error);
    } else if (typeof convertResult === "function") {
      callback(null, convertResult(result));
    } else {
      callback(null, result);
    }
  };
}
/**
 * @summary Create a Mongo-style `ObjectID`.  If you don't specify a `hexString`, the `ObjectID` will generated randomly (not using MongoDB's ID construction rules).
 * @locus Anywhere
 * @class
 * @param {String} [hexString] Optional.  The 24-character hexadecimal contents of the ObjectID to create
 */


Mongo.ObjectID = MongoID.ObjectID;
/**
 * @summary To create a cursor, use find. To access the documents in a cursor, use forEach, map, or fetch.
 * @class
 * @instanceName cursor
 */

Mongo.Cursor = LocalCollection.Cursor;
/**
 * @deprecated in 0.9.1
 */

Mongo.Collection.Cursor = Mongo.Cursor;
/**
 * @deprecated in 0.9.1
 */

Mongo.Collection.ObjectID = Mongo.ObjectID;
/**
 * @deprecated in 0.9.1
 */

Meteor.Collection = Mongo.Collection; // Allow deny stuff is now in the allow-deny package

Object.assign(Meteor.Collection.prototype, AllowDeny.CollectionPrototype);

function popCallbackFromArgs(args) {
  // Pull off any callback (or perhaps a 'callback' variable that was passed
  // in undefined, like how 'upsert' does it).
  if (args.length && (args[args.length - 1] === undefined || args[args.length - 1] instanceof Function)) {
    return args.pop();
  }
}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"connection_options.js":function(){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/connection_options.js                                                                                //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
/**
 * @summary Allows for user specified connection options
 * @example http://mongodb.github.io/node-mongodb-native/2.2/reference/connecting/connection-settings/
 * @locus Server
 * @param {Object} options User specified Mongo connection options
 */
Mongo.setConnectionOptions = function setConnectionOptions(options) {
  check(options, Object);
  Mongo._connectionOptions = options;
};
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});
require("/node_modules/meteor/mongo/mongo_driver.js");
require("/node_modules/meteor/mongo/oplog_tailing.js");
require("/node_modules/meteor/mongo/observe_multiplex.js");
require("/node_modules/meteor/mongo/doc_fetcher.js");
require("/node_modules/meteor/mongo/polling_observe_driver.js");
require("/node_modules/meteor/mongo/oplog_observe_driver.js");
require("/node_modules/meteor/mongo/local_collection_driver.js");
require("/node_modules/meteor/mongo/remote_collection_driver.js");
require("/node_modules/meteor/mongo/collection.js");
require("/node_modules/meteor/mongo/connection_options.js");

/* Exports */
Package._define("mongo", {
  MongoInternals: MongoInternals,
  MongoTest: MongoTest,
  Mongo: Mongo
});

})();

//# sourceURL=meteor://💻app/packages/mongo.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbW9uZ28vbW9uZ29fZHJpdmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9vcGxvZ190YWlsaW5nLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9vYnNlcnZlX211bHRpcGxleC5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbW9uZ28vZG9jX2ZldGNoZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21vbmdvL3BvbGxpbmdfb2JzZXJ2ZV9kcml2ZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21vbmdvL29wbG9nX29ic2VydmVfZHJpdmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9sb2NhbF9jb2xsZWN0aW9uX2RyaXZlci5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbW9uZ28vcmVtb3RlX2NvbGxlY3Rpb25fZHJpdmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9jb2xsZWN0aW9uLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9jb25uZWN0aW9uX29wdGlvbnMuanMiXSwibmFtZXMiOlsiTW9uZ29EQiIsIk5wbU1vZHVsZU1vbmdvZGIiLCJGdXR1cmUiLCJOcG0iLCJyZXF1aXJlIiwiTW9uZ29JbnRlcm5hbHMiLCJNb25nb1Rlc3QiLCJOcG1Nb2R1bGVzIiwibW9uZ29kYiIsInZlcnNpb24iLCJOcG1Nb2R1bGVNb25nb2RiVmVyc2lvbiIsIm1vZHVsZSIsIk5wbU1vZHVsZSIsInJlcGxhY2VOYW1lcyIsImZpbHRlciIsInRoaW5nIiwiXyIsImlzQXJyYXkiLCJtYXAiLCJiaW5kIiwicmV0IiwiZWFjaCIsInZhbHVlIiwia2V5IiwiVGltZXN0YW1wIiwicHJvdG90eXBlIiwiY2xvbmUiLCJtYWtlTW9uZ29MZWdhbCIsIm5hbWUiLCJ1bm1ha2VNb25nb0xlZ2FsIiwic3Vic3RyIiwicmVwbGFjZU1vbmdvQXRvbVdpdGhNZXRlb3IiLCJkb2N1bWVudCIsIkJpbmFyeSIsImJ1ZmZlciIsIlVpbnQ4QXJyYXkiLCJPYmplY3RJRCIsIk1vbmdvIiwidG9IZXhTdHJpbmciLCJzaXplIiwiRUpTT04iLCJmcm9tSlNPTlZhbHVlIiwidW5kZWZpbmVkIiwicmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28iLCJpc0JpbmFyeSIsIkJ1ZmZlciIsImZyb20iLCJfaXNDdXN0b21UeXBlIiwidG9KU09OVmFsdWUiLCJyZXBsYWNlVHlwZXMiLCJhdG9tVHJhbnNmb3JtZXIiLCJyZXBsYWNlZFRvcExldmVsQXRvbSIsInZhbCIsInZhbFJlcGxhY2VkIiwiTW9uZ29Db25uZWN0aW9uIiwidXJsIiwib3B0aW9ucyIsInNlbGYiLCJfb2JzZXJ2ZU11bHRpcGxleGVycyIsIl9vbkZhaWxvdmVySG9vayIsIkhvb2siLCJtb25nb09wdGlvbnMiLCJPYmplY3QiLCJhc3NpZ24iLCJhdXRvUmVjb25uZWN0IiwicmVjb25uZWN0VHJpZXMiLCJJbmZpbml0eSIsImlnbm9yZVVuZGVmaW5lZCIsIl9jb25uZWN0aW9uT3B0aW9ucyIsInRlc3QiLCJuYXRpdmVfcGFyc2VyIiwiaGFzIiwicG9vbFNpemUiLCJkYiIsIl9wcmltYXJ5IiwiX29wbG9nSGFuZGxlIiwiX2RvY0ZldGNoZXIiLCJjb25uZWN0RnV0dXJlIiwiY29ubmVjdCIsIk1ldGVvciIsImJpbmRFbnZpcm9ubWVudCIsImVyciIsInNlcnZlckNvbmZpZyIsImlzTWFzdGVyRG9jIiwicHJpbWFyeSIsIm9uIiwia2luZCIsImRvYyIsImNhbGxiYWNrIiwibWUiLCJyZXNvbHZlciIsIndhaXQiLCJvcGxvZ1VybCIsIlBhY2thZ2UiLCJPcGxvZ0hhbmRsZSIsImRhdGFiYXNlTmFtZSIsIkRvY0ZldGNoZXIiLCJjbG9zZSIsIkVycm9yIiwib3Bsb2dIYW5kbGUiLCJzdG9wIiwid3JhcCIsInJhd0NvbGxlY3Rpb24iLCJjb2xsZWN0aW9uTmFtZSIsImZ1dHVyZSIsImNvbGxlY3Rpb24iLCJfY3JlYXRlQ2FwcGVkQ29sbGVjdGlvbiIsImJ5dGVTaXplIiwibWF4RG9jdW1lbnRzIiwiY3JlYXRlQ29sbGVjdGlvbiIsImNhcHBlZCIsIm1heCIsIl9tYXliZUJlZ2luV3JpdGUiLCJmZW5jZSIsIkREUFNlcnZlciIsIl9DdXJyZW50V3JpdGVGZW5jZSIsImdldCIsImJlZ2luV3JpdGUiLCJjb21taXR0ZWQiLCJfb25GYWlsb3ZlciIsInJlZ2lzdGVyIiwid3JpdGVDYWxsYmFjayIsIndyaXRlIiwicmVmcmVzaCIsInJlc3VsdCIsInJlZnJlc2hFcnIiLCJiaW5kRW52aXJvbm1lbnRGb3JXcml0ZSIsIl9pbnNlcnQiLCJjb2xsZWN0aW9uX25hbWUiLCJzZW5kRXJyb3IiLCJlIiwiX2V4cGVjdGVkQnlUZXN0IiwiTG9jYWxDb2xsZWN0aW9uIiwiX2lzUGxhaW5PYmplY3QiLCJpZCIsIl9pZCIsImluc2VydCIsInNhZmUiLCJfcmVmcmVzaCIsInNlbGVjdG9yIiwicmVmcmVzaEtleSIsInNwZWNpZmljSWRzIiwiX2lkc01hdGNoZWRCeVNlbGVjdG9yIiwiZXh0ZW5kIiwiX3JlbW92ZSIsIndyYXBwZWRDYWxsYmFjayIsImRyaXZlclJlc3VsdCIsInRyYW5zZm9ybVJlc3VsdCIsIm51bWJlckFmZmVjdGVkIiwicmVtb3ZlIiwiX2Ryb3BDb2xsZWN0aW9uIiwiY2IiLCJkcm9wQ29sbGVjdGlvbiIsImRyb3AiLCJfZHJvcERhdGFiYXNlIiwiZHJvcERhdGFiYXNlIiwiX3VwZGF0ZSIsIm1vZCIsIkZ1bmN0aW9uIiwibW9uZ29PcHRzIiwidXBzZXJ0IiwibXVsdGkiLCJmdWxsUmVzdWx0IiwibW9uZ29TZWxlY3RvciIsIm1vbmdvTW9kIiwiaXNNb2RpZnkiLCJfaXNNb2RpZmljYXRpb25Nb2QiLCJfZm9yYmlkUmVwbGFjZSIsImtub3duSWQiLCJuZXdEb2MiLCJfY3JlYXRlVXBzZXJ0RG9jdW1lbnQiLCJpbnNlcnRlZElkIiwiZ2VuZXJhdGVkSWQiLCJzaW11bGF0ZVVwc2VydFdpdGhJbnNlcnRlZElkIiwiZXJyb3IiLCJfcmV0dXJuT2JqZWN0IiwiaGFzT3duUHJvcGVydHkiLCIkc2V0T25JbnNlcnQiLCJ1cGRhdGUiLCJtZXRlb3JSZXN1bHQiLCJtb25nb1Jlc3VsdCIsInVwc2VydGVkIiwibGVuZ3RoIiwibiIsIk5VTV9PUFRJTUlTVElDX1RSSUVTIiwiX2lzQ2Fubm90Q2hhbmdlSWRFcnJvciIsImVycm1zZyIsImluZGV4T2YiLCJtb25nb09wdHNGb3JVcGRhdGUiLCJtb25nb09wdHNGb3JJbnNlcnQiLCJyZXBsYWNlbWVudFdpdGhJZCIsInRyaWVzIiwiZG9VcGRhdGUiLCJkb0NvbmRpdGlvbmFsSW5zZXJ0IiwibWV0aG9kIiwid3JhcEFzeW5jIiwiYXBwbHkiLCJhcmd1bWVudHMiLCJmaW5kIiwiQ3Vyc29yIiwiQ3Vyc29yRGVzY3JpcHRpb24iLCJmaW5kT25lIiwibGltaXQiLCJmZXRjaCIsIl9lbnN1cmVJbmRleCIsImluZGV4IiwiaW5kZXhOYW1lIiwiZW5zdXJlSW5kZXgiLCJfZHJvcEluZGV4IiwiZHJvcEluZGV4IiwiQ29sbGVjdGlvbiIsIl9yZXdyaXRlU2VsZWN0b3IiLCJtb25nbyIsImN1cnNvckRlc2NyaXB0aW9uIiwiX21vbmdvIiwiX2N1cnNvckRlc2NyaXB0aW9uIiwiX3N5bmNocm9ub3VzQ3Vyc29yIiwidGFpbGFibGUiLCJfY3JlYXRlU3luY2hyb25vdXNDdXJzb3IiLCJzZWxmRm9ySXRlcmF0aW9uIiwidXNlVHJhbnNmb3JtIiwicmV3aW5kIiwiZ2V0VHJhbnNmb3JtIiwidHJhbnNmb3JtIiwiX3B1Ymxpc2hDdXJzb3IiLCJzdWIiLCJfZ2V0Q29sbGVjdGlvbk5hbWUiLCJvYnNlcnZlIiwiY2FsbGJhY2tzIiwiX29ic2VydmVGcm9tT2JzZXJ2ZUNoYW5nZXMiLCJvYnNlcnZlQ2hhbmdlcyIsIm1ldGhvZHMiLCJvcmRlcmVkIiwiX29ic2VydmVDaGFuZ2VzQ2FsbGJhY2tzQXJlT3JkZXJlZCIsImV4Y2VwdGlvbk5hbWUiLCJmb3JFYWNoIiwiX29ic2VydmVDaGFuZ2VzIiwicGljayIsImN1cnNvck9wdGlvbnMiLCJzb3J0Iiwic2tpcCIsImF3YWl0ZGF0YSIsIm51bWJlck9mUmV0cmllcyIsIk9QTE9HX0NPTExFQ1RJT04iLCJ0cyIsIm9wbG9nUmVwbGF5IiwiZGJDdXJzb3IiLCJmaWVsZHMiLCJtYXhUaW1lTXMiLCJtYXhUaW1lTVMiLCJoaW50IiwiU3luY2hyb25vdXNDdXJzb3IiLCJfZGJDdXJzb3IiLCJfc2VsZkZvckl0ZXJhdGlvbiIsIl90cmFuc2Zvcm0iLCJ3cmFwVHJhbnNmb3JtIiwiX3N5bmNocm9ub3VzTmV4dE9iamVjdCIsIm5leHRPYmplY3QiLCJfc3luY2hyb25vdXNDb3VudCIsImNvdW50IiwiX3Zpc2l0ZWRJZHMiLCJfSWRNYXAiLCJfbmV4dE9iamVjdCIsInNldCIsInRoaXNBcmciLCJfcmV3aW5kIiwiY2FsbCIsInJlcyIsInB1c2giLCJpZGVudGl0eSIsImFwcGx5U2tpcExpbWl0IiwiZ2V0UmF3T2JqZWN0cyIsInJlc3VsdHMiLCJ0YWlsIiwiZG9jQ2FsbGJhY2siLCJjdXJzb3IiLCJzdG9wcGVkIiwibGFzdFRTIiwibG9vcCIsIm5ld1NlbGVjdG9yIiwiJGd0Iiwic2V0VGltZW91dCIsImRlZmVyIiwiX29ic2VydmVDaGFuZ2VzVGFpbGFibGUiLCJvYnNlcnZlS2V5Iiwic3RyaW5naWZ5IiwibXVsdGlwbGV4ZXIiLCJvYnNlcnZlRHJpdmVyIiwiZmlyc3RIYW5kbGUiLCJfbm9ZaWVsZHNBbGxvd2VkIiwiT2JzZXJ2ZU11bHRpcGxleGVyIiwib25TdG9wIiwib2JzZXJ2ZUhhbmRsZSIsIk9ic2VydmVIYW5kbGUiLCJtYXRjaGVyIiwic29ydGVyIiwiY2FuVXNlT3Bsb2ciLCJhbGwiLCJfdGVzdE9ubHlQb2xsQ2FsbGJhY2siLCJNaW5pbW9uZ28iLCJNYXRjaGVyIiwiT3Bsb2dPYnNlcnZlRHJpdmVyIiwiY3Vyc29yU3VwcG9ydGVkIiwiU29ydGVyIiwiZiIsImRyaXZlckNsYXNzIiwiUG9sbGluZ09ic2VydmVEcml2ZXIiLCJtb25nb0hhbmRsZSIsIl9vYnNlcnZlRHJpdmVyIiwiYWRkSGFuZGxlQW5kU2VuZEluaXRpYWxBZGRzIiwibGlzdGVuQWxsIiwibGlzdGVuQ2FsbGJhY2siLCJsaXN0ZW5lcnMiLCJmb3JFYWNoVHJpZ2dlciIsInRyaWdnZXIiLCJfSW52YWxpZGF0aW9uQ3Jvc3NiYXIiLCJsaXN0ZW4iLCJsaXN0ZW5lciIsInRyaWdnZXJDYWxsYmFjayIsImFkZGVkQmVmb3JlIiwiYWRkZWQiLCJNb25nb1RpbWVzdGFtcCIsIkNvbm5lY3Rpb24iLCJUT09fRkFSX0JFSElORCIsInByb2Nlc3MiLCJlbnYiLCJNRVRFT1JfT1BMT0dfVE9PX0ZBUl9CRUhJTkQiLCJzaG93VFMiLCJnZXRIaWdoQml0cyIsImdldExvd0JpdHMiLCJpZEZvck9wIiwib3AiLCJvIiwibzIiLCJkYk5hbWUiLCJfb3Bsb2dVcmwiLCJfZGJOYW1lIiwiX29wbG9nTGFzdEVudHJ5Q29ubmVjdGlvbiIsIl9vcGxvZ1RhaWxDb25uZWN0aW9uIiwiX3N0b3BwZWQiLCJfdGFpbEhhbmRsZSIsIl9yZWFkeUZ1dHVyZSIsIl9jcm9zc2JhciIsIl9Dcm9zc2JhciIsImZhY3RQYWNrYWdlIiwiZmFjdE5hbWUiLCJfYmFzZU9wbG9nU2VsZWN0b3IiLCJucyIsIlJlZ0V4cCIsIl9lc2NhcGVSZWdFeHAiLCIkb3IiLCIkaW4iLCIkZXhpc3RzIiwiX2NhdGNoaW5nVXBGdXR1cmVzIiwiX2xhc3RQcm9jZXNzZWRUUyIsIl9vblNraXBwZWRFbnRyaWVzSG9vayIsImRlYnVnUHJpbnRFeGNlcHRpb25zIiwiX2VudHJ5UXVldWUiLCJfRG91YmxlRW5kZWRRdWV1ZSIsIl93b3JrZXJBY3RpdmUiLCJfc3RhcnRUYWlsaW5nIiwib25PcGxvZ0VudHJ5Iiwib3JpZ2luYWxDYWxsYmFjayIsIm5vdGlmaWNhdGlvbiIsIl9kZWJ1ZyIsInN0YWNrIiwibGlzdGVuSGFuZGxlIiwib25Ta2lwcGVkRW50cmllcyIsIndhaXRVbnRpbENhdWdodFVwIiwibGFzdEVudHJ5IiwiJG5hdHVyYWwiLCJfc2xlZXBGb3JNcyIsImxlc3NUaGFuT3JFcXVhbCIsImluc2VydEFmdGVyIiwiZ3JlYXRlclRoYW4iLCJzcGxpY2UiLCJtb25nb2RiVXJpIiwicGFyc2UiLCJkYXRhYmFzZSIsImFkbWluIiwiY29tbWFuZCIsImlzbWFzdGVyIiwic2V0TmFtZSIsImxhc3RPcGxvZ0VudHJ5Iiwib3Bsb2dTZWxlY3RvciIsIl9tYXliZVN0YXJ0V29ya2VyIiwicmV0dXJuIiwiaXNFbXB0eSIsInBvcCIsImNsZWFyIiwiX3NldExhc3RQcm9jZXNzZWRUUyIsInNoaWZ0IiwiSlNPTiIsImZpcmUiLCJzZXF1ZW5jZXIiLCJfZGVmaW5lVG9vRmFyQmVoaW5kIiwiX3Jlc2V0VG9vRmFyQmVoaW5kIiwiZmFjdHMiLCJGYWN0cyIsImluY3JlbWVudFNlcnZlckZhY3QiLCJfb3JkZXJlZCIsIl9vblN0b3AiLCJfcXVldWUiLCJfU3luY2hyb25vdXNRdWV1ZSIsIl9oYW5kbGVzIiwiX2NhY2hlIiwiX0NhY2hpbmdDaGFuZ2VPYnNlcnZlciIsIl9hZGRIYW5kbGVUYXNrc1NjaGVkdWxlZEJ1dE5vdFBlcmZvcm1lZCIsImNhbGxiYWNrTmFtZXMiLCJjYWxsYmFja05hbWUiLCJfYXBwbHlDYWxsYmFjayIsInRvQXJyYXkiLCJoYW5kbGUiLCJzYWZlVG9SdW5UYXNrIiwicnVuVGFzayIsIl9zZW5kQWRkcyIsInJlbW92ZUhhbmRsZSIsIl9yZWFkeSIsIl9zdG9wIiwiZnJvbVF1ZXJ5RXJyb3IiLCJyZWFkeSIsInF1ZXVlVGFzayIsInF1ZXJ5RXJyb3IiLCJ0aHJvdyIsIm9uRmx1c2giLCJpc1Jlc29sdmVkIiwiYXJncyIsImFwcGx5Q2hhbmdlIiwia2V5cyIsImhhbmRsZUlkIiwiYWRkIiwiX2FkZGVkQmVmb3JlIiwiX2FkZGVkIiwiZG9jcyIsIm5leHRPYnNlcnZlSGFuZGxlSWQiLCJfbXVsdGlwbGV4ZXIiLCJiZWZvcmUiLCJGaWJlciIsIm1vbmdvQ29ubmVjdGlvbiIsIl9tb25nb0Nvbm5lY3Rpb24iLCJfY2FsbGJhY2tzRm9yQ2FjaGVLZXkiLCJjYWNoZUtleSIsImNoZWNrIiwiU3RyaW5nIiwiY2xvbmVkRG9jIiwicnVuIiwiX21vbmdvSGFuZGxlIiwiX3N0b3BDYWxsYmFja3MiLCJfcmVzdWx0cyIsIl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQiLCJfcGVuZGluZ1dyaXRlcyIsIl9lbnN1cmVQb2xsSXNTY2hlZHVsZWQiLCJ0aHJvdHRsZSIsIl91bnRocm90dGxlZEVuc3VyZVBvbGxJc1NjaGVkdWxlZCIsInBvbGxpbmdUaHJvdHRsZU1zIiwiX3Rhc2tRdWV1ZSIsImxpc3RlbmVyc0hhbmRsZSIsInBvbGxpbmdJbnRlcnZhbCIsInBvbGxpbmdJbnRlcnZhbE1zIiwiX3BvbGxpbmdJbnRlcnZhbCIsImludGVydmFsSGFuZGxlIiwic2V0SW50ZXJ2YWwiLCJjbGVhckludGVydmFsIiwiX3BvbGxNb25nbyIsIl9zdXNwZW5kUG9sbGluZyIsIl9yZXN1bWVQb2xsaW5nIiwiZmlyc3QiLCJuZXdSZXN1bHRzIiwib2xkUmVzdWx0cyIsIndyaXRlc0ZvckN5Y2xlIiwiY29kZSIsIm1lc3NhZ2UiLCJBcnJheSIsIl9kaWZmUXVlcnlDaGFuZ2VzIiwidyIsImMiLCJQSEFTRSIsIlFVRVJZSU5HIiwiRkVUQ0hJTkciLCJTVEVBRFkiLCJTd2l0Y2hlZFRvUXVlcnkiLCJmaW5pc2hJZk5lZWRUb1BvbGxRdWVyeSIsImN1cnJlbnRJZCIsIl91c2VzT3Bsb2ciLCJjb21wYXJhdG9yIiwiZ2V0Q29tcGFyYXRvciIsImhlYXBPcHRpb25zIiwiSWRNYXAiLCJfbGltaXQiLCJfY29tcGFyYXRvciIsIl9zb3J0ZXIiLCJfdW5wdWJsaXNoZWRCdWZmZXIiLCJNaW5NYXhIZWFwIiwiX3B1Ymxpc2hlZCIsIk1heEhlYXAiLCJfc2FmZUFwcGVuZFRvQnVmZmVyIiwiX3N0b3BIYW5kbGVzIiwiX3JlZ2lzdGVyUGhhc2VDaGFuZ2UiLCJfbWF0Y2hlciIsInByb2plY3Rpb24iLCJfcHJvamVjdGlvbkZuIiwiX2NvbXBpbGVQcm9qZWN0aW9uIiwiX3NoYXJlZFByb2plY3Rpb24iLCJjb21iaW5lSW50b1Byb2plY3Rpb24iLCJfc2hhcmVkUHJvamVjdGlvbkZuIiwiX25lZWRUb0ZldGNoIiwiX2N1cnJlbnRseUZldGNoaW5nIiwiX2ZldGNoR2VuZXJhdGlvbiIsIl9yZXF1ZXJ5V2hlbkRvbmVUaGlzUXVlcnkiLCJfd3JpdGVzVG9Db21taXRXaGVuV2VSZWFjaFN0ZWFkeSIsIl9uZWVkVG9Qb2xsUXVlcnkiLCJfcGhhc2UiLCJfaGFuZGxlT3Bsb2dFbnRyeVF1ZXJ5aW5nIiwiX2hhbmRsZU9wbG9nRW50cnlTdGVhZHlPckZldGNoaW5nIiwiZmlyZWQiLCJfb3Bsb2dPYnNlcnZlRHJpdmVycyIsIm9uQmVmb3JlRmlyZSIsImRyaXZlcnMiLCJkcml2ZXIiLCJfcnVuSW5pdGlhbFF1ZXJ5IiwiX2FkZFB1Ymxpc2hlZCIsIm92ZXJmbG93aW5nRG9jSWQiLCJtYXhFbGVtZW50SWQiLCJvdmVyZmxvd2luZ0RvYyIsImVxdWFscyIsInJlbW92ZWQiLCJfYWRkQnVmZmVyZWQiLCJfcmVtb3ZlUHVibGlzaGVkIiwiZW1wdHkiLCJuZXdEb2NJZCIsIm1pbkVsZW1lbnRJZCIsIl9yZW1vdmVCdWZmZXJlZCIsIl9jaGFuZ2VQdWJsaXNoZWQiLCJvbGREb2MiLCJwcm9qZWN0ZWROZXciLCJwcm9qZWN0ZWRPbGQiLCJjaGFuZ2VkIiwiRGlmZlNlcXVlbmNlIiwibWFrZUNoYW5nZWRGaWVsZHMiLCJtYXhCdWZmZXJlZElkIiwiX2FkZE1hdGNoaW5nIiwibWF4UHVibGlzaGVkIiwibWF4QnVmZmVyZWQiLCJ0b1B1Ymxpc2giLCJjYW5BcHBlbmRUb0J1ZmZlciIsImNhbkluc2VydEludG9CdWZmZXIiLCJ0b0J1ZmZlciIsIl9yZW1vdmVNYXRjaGluZyIsIl9oYW5kbGVEb2MiLCJtYXRjaGVzTm93IiwiZG9jdW1lbnRNYXRjaGVzIiwicHVibGlzaGVkQmVmb3JlIiwiYnVmZmVyZWRCZWZvcmUiLCJjYWNoZWRCZWZvcmUiLCJtaW5CdWZmZXJlZCIsInN0YXlzSW5QdWJsaXNoZWQiLCJzdGF5c0luQnVmZmVyIiwiX2ZldGNoTW9kaWZpZWREb2N1bWVudHMiLCJ0aGlzR2VuZXJhdGlvbiIsIndhaXRpbmciLCJmdXQiLCJfYmVTdGVhZHkiLCJ3cml0ZXMiLCJ0b1N0cmluZyIsImlzUmVwbGFjZSIsImNhbkRpcmVjdGx5TW9kaWZ5RG9jIiwibW9kaWZpZXJDYW5CZURpcmVjdGx5QXBwbGllZCIsIl9tb2RpZnkiLCJjYW5CZWNvbWVUcnVlQnlNb2RpZmllciIsImFmZmVjdGVkQnlNb2RpZmllciIsIl9ydW5RdWVyeSIsImluaXRpYWwiLCJfZG9uZVF1ZXJ5aW5nIiwiX3BvbGxRdWVyeSIsIm5ld0J1ZmZlciIsIl9jdXJzb3JGb3JRdWVyeSIsImkiLCJfcHVibGlzaE5ld1Jlc3VsdHMiLCJvcHRpb25zT3ZlcndyaXRlIiwiZGVzY3JpcHRpb24iLCJpZHNUb1JlbW92ZSIsIl9vcGxvZ0VudHJ5SGFuZGxlIiwiX2xpc3RlbmVyc0hhbmRsZSIsInBoYXNlIiwibm93IiwiRGF0ZSIsInRpbWVEaWZmIiwiX3BoYXNlU3RhcnRUaW1lIiwiZGlzYWJsZU9wbG9nIiwiX2Rpc2FibGVPcGxvZyIsIl9jaGVja1N1cHBvcnRlZFByb2plY3Rpb24iLCJoYXNXaGVyZSIsImhhc0dlb1F1ZXJ5IiwibW9kaWZpZXIiLCJvcGVyYXRpb24iLCJmaWVsZCIsImV4cG9ydCIsIkxvY2FsQ29sbGVjdGlvbkRyaXZlciIsImNvbnN0cnVjdG9yIiwibm9Db25uQ29sbGVjdGlvbnMiLCJjcmVhdGUiLCJvcGVuIiwiY29ubiIsImVuc3VyZUNvbGxlY3Rpb24iLCJfbW9uZ29fbGl2ZWRhdGFfY29sbGVjdGlvbnMiLCJjb2xsZWN0aW9ucyIsIlJlbW90ZUNvbGxlY3Rpb25Ecml2ZXIiLCJtb25nb191cmwiLCJtIiwiZGVmYXVsdFJlbW90ZUNvbGxlY3Rpb25Ecml2ZXIiLCJvbmNlIiwiY29ubmVjdGlvbk9wdGlvbnMiLCJtb25nb1VybCIsIk1PTkdPX1VSTCIsIk1PTkdPX09QTE9HX1VSTCIsImNvbm5lY3Rpb24iLCJtYW5hZ2VyIiwiaWRHZW5lcmF0aW9uIiwiX2RyaXZlciIsIl9wcmV2ZW50QXV0b3B1Ymxpc2giLCJfbWFrZU5ld0lEIiwic3JjIiwiRERQIiwicmFuZG9tU3RyZWFtIiwiUmFuZG9tIiwiaW5zZWN1cmUiLCJoZXhTdHJpbmciLCJfY29ubmVjdGlvbiIsImlzQ2xpZW50Iiwic2VydmVyIiwiX2NvbGxlY3Rpb24iLCJfbmFtZSIsIl9tYXliZVNldFVwUmVwbGljYXRpb24iLCJkZWZpbmVNdXRhdGlvbk1ldGhvZHMiLCJfZGVmaW5lTXV0YXRpb25NZXRob2RzIiwidXNlRXhpc3RpbmciLCJfc3VwcHJlc3NTYW1lTmFtZUVycm9yIiwiYXV0b3B1Ymxpc2giLCJwdWJsaXNoIiwiaXNfYXV0byIsInJlZ2lzdGVyU3RvcmUiLCJvayIsImJlZ2luVXBkYXRlIiwiYmF0Y2hTaXplIiwicmVzZXQiLCJwYXVzZU9ic2VydmVycyIsIm1zZyIsIm1vbmdvSWQiLCJNb25nb0lEIiwiaWRQYXJzZSIsInJlcGxhY2UiLCIkdW5zZXQiLCIkc2V0IiwiZW5kVXBkYXRlIiwicmVzdW1lT2JzZXJ2ZXJzIiwic2F2ZU9yaWdpbmFscyIsInJldHJpZXZlT3JpZ2luYWxzIiwiZ2V0RG9jIiwiX2dldENvbGxlY3Rpb24iLCJjb25zb2xlIiwid2FybiIsImxvZyIsIl9nZXRGaW5kU2VsZWN0b3IiLCJfZ2V0RmluZE9wdGlvbnMiLCJNYXRjaCIsIk9wdGlvbmFsIiwiT2JqZWN0SW5jbHVkaW5nIiwiT25lT2YiLCJOdW1iZXIiLCJmYWxsYmFja0lkIiwiX3NlbGVjdG9ySXNJZCIsImdldFByb3RvdHlwZU9mIiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9ycyIsImdlbmVyYXRlSWQiLCJfaXNSZW1vdGVDb2xsZWN0aW9uIiwiZW5jbG9zaW5nIiwiX0N1cnJlbnRNZXRob2RJbnZvY2F0aW9uIiwiY2hvb3NlUmV0dXJuVmFsdWVGcm9tQ29sbGVjdGlvblJlc3VsdCIsIndyYXBDYWxsYmFjayIsIl9jYWxsTXV0YXRvck1ldGhvZCIsIm9wdGlvbnNBbmRDYWxsYmFjayIsInBvcENhbGxiYWNrRnJvbUFyZ3MiLCJyYXdEYXRhYmFzZSIsImNvbnZlcnRSZXN1bHQiLCJBbGxvd0RlbnkiLCJDb2xsZWN0aW9uUHJvdG90eXBlIiwic2V0Q29ubmVjdGlvbk9wdGlvbnMiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBOzs7Ozs7OztBQVNBLElBQUlBLFVBQVVDLGdCQUFkOztBQUNBLElBQUlDLFNBQVNDLElBQUlDLE9BQUosQ0FBWSxlQUFaLENBQWI7O0FBRUFDLGlCQUFpQixFQUFqQjtBQUNBQyxZQUFZLEVBQVo7QUFFQUQsZUFBZUUsVUFBZixHQUE0QjtBQUMxQkMsV0FBUztBQUNQQyxhQUFTQyx1QkFERjtBQUVQQyxZQUFRWDtBQUZEO0FBRGlCLENBQTVCLEMsQ0FPQTtBQUNBO0FBQ0E7QUFDQTs7QUFDQUssZUFBZU8sU0FBZixHQUEyQlosT0FBM0IsQyxDQUVBO0FBQ0E7O0FBQ0EsSUFBSWEsZUFBZSxVQUFVQyxNQUFWLEVBQWtCQyxLQUFsQixFQUF5QjtBQUMxQyxNQUFJLE9BQU9BLEtBQVAsS0FBaUIsUUFBckIsRUFBK0I7QUFDN0IsUUFBSUMsRUFBRUMsT0FBRixDQUFVRixLQUFWLENBQUosRUFBc0I7QUFDcEIsYUFBT0MsRUFBRUUsR0FBRixDQUFNSCxLQUFOLEVBQWFDLEVBQUVHLElBQUYsQ0FBT04sWUFBUCxFQUFxQixJQUFyQixFQUEyQkMsTUFBM0IsQ0FBYixDQUFQO0FBQ0Q7O0FBQ0QsUUFBSU0sTUFBTSxFQUFWOztBQUNBSixNQUFFSyxJQUFGLENBQU9OLEtBQVAsRUFBYyxVQUFVTyxLQUFWLEVBQWlCQyxHQUFqQixFQUFzQjtBQUNsQ0gsVUFBSU4sT0FBT1MsR0FBUCxDQUFKLElBQW1CVixhQUFhQyxNQUFiLEVBQXFCUSxLQUFyQixDQUFuQjtBQUNELEtBRkQ7O0FBR0EsV0FBT0YsR0FBUDtBQUNEOztBQUNELFNBQU9MLEtBQVA7QUFDRCxDQVpE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U0FEcEIsRUFFRW1wQixVQUFVQyxtQkFGWjs7QUFLQSxTQUFTSixtQkFBVCxDQUE2Qi9QLElBQTdCLEVBQW1DO0FBQ2pDO0FBQ0E7QUFDQSxNQUFJQSxLQUFLcFAsTUFBTCxLQUNDb1AsS0FBS0EsS0FBS3BQLE1BQUwsR0FBYyxDQUFuQixNQUEwQjVJLFNBQTFCLElBQ0FnWSxLQUFLQSxLQUFLcFAsTUFBTCxHQUFjLENBQW5CLGFBQWlDeEIsUUFGbEMsQ0FBSixFQUVpRDtBQUMvQyxXQUFPNFEsS0FBS3RDLEdBQUwsRUFBUDtBQUNEO0FBQ0YsQzs7Ozs7Ozs7Ozs7QUM3dkJEOzs7Ozs7QUFNQS9WLE1BQU15b0Isb0JBQU4sR0FBNkIsU0FBU0Esb0JBQVQsQ0FBK0J0bkIsT0FBL0IsRUFBd0M7QUFDbkVrWSxRQUFNbFksT0FBTixFQUFlTSxNQUFmO0FBQ0F6QixRQUFNK0Isa0JBQU4sR0FBMkJaLE9BQTNCO0FBQ0QsQ0FIRCxDIiwiZmlsZSI6Ii9wYWNrYWdlcy9tb25nby5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUHJvdmlkZSBhIHN5bmNocm9ub3VzIENvbGxlY3Rpb24gQVBJIHVzaW5nIGZpYmVycywgYmFja2VkIGJ5XG4gKiBNb25nb0RCLiAgVGhpcyBpcyBvbmx5IGZvciB1c2Ugb24gdGhlIHNlcnZlciwgYW5kIG1vc3RseSBpZGVudGljYWxcbiAqIHRvIHRoZSBjbGllbnQgQVBJLlxuICpcbiAqIE5PVEU6IHRoZSBwdWJsaWMgQVBJIG1ldGhvZHMgbXVzdCBiZSBydW4gd2l0aGluIGEgZmliZXIuIElmIHlvdSBjYWxsXG4gKiB0aGVzZSBvdXRzaWRlIG9mIGEgZmliZXIgdGhleSB3aWxsIGV4cGxvZGUhXG4gKi9cblxudmFyIE1vbmdvREIgPSBOcG1Nb2R1bGVNb25nb2RiO1xudmFyIEZ1dHVyZSA9IE5wbS5yZXF1aXJlKCdmaWJlcnMvZnV0dXJlJyk7XG5cbk1vbmdvSW50ZXJuYWxzID0ge307XG5Nb25nb1Rlc3QgPSB7fTtcblxuTW9uZ29JbnRlcm5hbHMuTnBtTW9kdWxlcyA9IHtcbiAgbW9uZ29kYjoge1xuICAgIHZlcnNpb246IE5wbU1vZHVsZU1vbmdvZGJWZXJzaW9uLFxuICAgIG1vZHVsZTogTW9uZ29EQlxuICB9XG59O1xuXG4vLyBPbGRlciB2ZXJzaW9uIG9mIHdoYXQgaXMgbm93IGF2YWlsYWJsZSB2aWFcbi8vIE1vbmdvSW50ZXJuYWxzLk5wbU1vZHVsZXMubW9uZ29kYi5tb2R1bGUuICBJdCB3YXMgbmV2ZXIgZG9jdW1lbnRlZCwgYnV0XG4vLyBwZW9wbGUgZG8gdXNlIGl0LlxuLy8gWFhYIENPTVBBVCBXSVRIIDEuMC4zLjJcbk1vbmdvSW50ZXJuYWxzLk5wbU1vZHVsZSA9IE1vbmdvREI7XG5cbi8vIFRoaXMgaXMgdXNlZCB0byBhZGQgb3IgcmVtb3ZlIEVKU09OIGZyb20gdGhlIGJlZ2lubmluZyBvZiBldmVyeXRoaW5nIG5lc3RlZFxuLy8gaW5zaWRlIGFuIEVKU09OIGN1c3RvbSB0eXBlLiBJdCBzaG91bGQgb25seSBiZSBjYWxsZWQgb24gcHVyZSBKU09OIVxudmFyIHJlcGxhY2VOYW1lcyA9IGZ1bmN0aW9uIChmaWx0ZXIsIHRoaW5nKSB7XG4gIGlmICh0eXBlb2YgdGhpbmcgPT09IFwib2JqZWN0XCIpIHtcbiAgICBpZiAoXy5pc0FycmF5KHRoaW5nKSkge1xuICAgICAgcmV0dXJuIF8ubWFwKHRoaW5nLCBfLmJpbmQocmVwbGFjZU5hbWVzLCBudWxsLCBmaWx0ZXIpKTtcbiAgICB9XG4gICAgdmFyIHJldCA9IHt9O1xuICAgIF8uZWFjaCh0aGluZywgZnVuY3Rpb24gKHZhbHVlLCBrZXkpIHtcbiAgICAgIHJldFtmaWx0ZXIoa2V5KV0gPSByZXBsYWNlTmFtZXMoZmlsdGVyLCB2YWx1ZSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHJldDtcbiAgfVxuICByZXR1cm4gdGhpbmc7XG59O1xuXG4vLyBFbnN1cmUgdGhhdCBFSlNPTi5jbG9uZSBrZWVwcyBhIFRpbWVzdGFtcCBhcyBhIFRpbWVzdGFtcCAoaW5zdGVhZCBvZiBqdXN0XG4vLyBkb2luZyBhIHN0cnVjdHVyYWwgY2xvbmUpLlxuLy8gWFhYIGhvdyBvayBpcyB0aGlzPyB3aGF0IGlmIHRoZXJlIGFyZSBtdWx0aXBsZSBjb3BpZXMgb2YgTW9uZ29EQiBsb2FkZWQ/XG5Nb25nb0RCLlRpbWVzdGFtcC5wcm90b3R5cGUuY2xvbmUgPSBmdW5jdGlvbiAoKSB7XG4gIC8vIFRpbWVzdGFtcHMgc2hvdWxkIGJlIGltbXV0YWJsZS5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG52YXIgbWFrZU1vbmdvTGVnYWwgPSBmdW5jdGlvbiAobmFtZSkgeyByZXR1cm4gXCJFSlNPTlwiICsgbmFtZTsgfTtcbnZhciB1bm1ha2VNb25nb0xlZ2FsID0gZnVuY3Rpb24gKG5hbWUpIHsgcmV0dXJuIG5hbWUuc3Vic3RyKDUpOyB9O1xuXG52YXIgcmVwbGFjZU1vbmdvQXRvbVdpdGhNZXRlb3IgPSBmdW5jdGlvbiAoZG9jdW1lbnQpIHtcbiAgaWYgKGRvY3VtZW50IGluc3RhbmNlb2YgTW9uZ29EQi5CaW5hcnkpIHtcbiAgICB2YXIgYnVmZmVyID0gZG9jdW1lbnQudmFsdWUodHJ1ZSk7XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGJ1ZmZlcik7XG4gIH1cbiAgaWYgKGRvY3VtZW50IGluc3RhbmNlb2YgTW9uZ29EQi5PYmplY3RJRCkge1xuICAgIHJldHVybiBuZXcgTW9uZ28uT2JqZWN0SUQoZG9jdW1lbnQudG9IZXhTdHJpbmcoKSk7XG4gIH1cbiAgaWYgKGRvY3VtZW50W1wiRUpTT04kdHlwZVwiXSAmJiBkb2N1bWVudFtcIkVKU09OJHZhbHVlXCJdICYmIF8uc2l6ZShkb2N1bWVudCkgPT09IDIpIHtcbiAgICByZXR1cm4gRUpTT04uZnJvbUpTT05WYWx1ZShyZXBsYWNlTmFtZXModW5tYWtlTW9uZ29MZWdhbCwgZG9jdW1lbnQpKTtcbiAgfVxuICBpZiAoZG9jdW1lbnQgaW5zdGFuY2VvZiBNb25nb0RCLlRpbWVzdGFtcCkge1xuICAgIC8vIEZvciBub3csIHRoZSBNZXRlb3IgcmVwcmVzZW50YXRpb24gb2YgYSBNb25nbyB0aW1lc3RhbXAgdHlwZSAobm90IGEgZGF0ZSFcbiAgICAvLyB0aGlzIGlzIGEgd2VpcmQgaW50ZXJuYWwgdGhpbmcgdXNlZCBpbiB0aGUgb3Bsb2chKSBpcyB0aGUgc2FtZSBhcyB0aGVcbiAgICAvLyBNb25nbyByZXByZXNlbnRhdGlvbi4gV2UgbmVlZCB0byBkbyB0aGlzIGV4cGxpY2l0bHkgb3IgZWxzZSB3ZSB3b3VsZCBkbyBhXG4gICAgLy8gc3RydWN0dXJhbCBjbG9uZSBhbmQgbG9zZSB0aGUgcHJvdG90eXBlLlxuICAgIHJldHVybiBkb2N1bWVudDtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufTtcblxudmFyIHJlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvID0gZnVuY3Rpb24gKGRvY3VtZW50KSB7XG4gIGlmIChFSlNPTi5pc0JpbmFyeShkb2N1bWVudCkpIHtcbiAgICAvLyBUaGlzIGRvZXMgbW9yZSBjb3BpZXMgdGhhbiB3ZSdkIGxpa2UsIGJ1dCBpcyBuZWNlc3NhcnkgYmVjYXVzZVxuICAgIC8vIE1vbmdvREIuQlNPTiBvbmx5IGxvb2tzIGxpa2UgaXQgdGFrZXMgYSBVaW50OEFycmF5IChhbmQgZG9lc24ndCBhY3R1YWxseVxuICAgIC8vIHNlcmlhbGl6ZSBpdCBjb3JyZWN0bHkpLlxuICAgIHJldHVybiBuZXcgTW9uZ29EQi5CaW5hcnkoQnVmZmVyLmZyb20oZG9jdW1lbnQpKTtcbiAgfVxuICBpZiAoZG9jdW1lbnQgaW5zdGFuY2VvZiBNb25nby5PYmplY3RJRCkge1xuICAgIHJldHVybiBuZXcgTW9uZ29EQi5PYmplY3RJRChkb2N1bWVudC50b0hleFN0cmluZygpKTtcbiAgfVxuICBpZiAoZG9jdW1lbnQgaW5zdGFuY2VvZiBNb25nb0RCLlRpbWVzdGFtcCkge1xuICAgIC8vIEZvciBub3csIHRoZSBNZXRlb3IgcmVwcmVzZW50YXRpb24gb2YgYSBNb25nbyB0aW1lc3RhbXAgdHlwZSAobm90IGEgZGF0ZSFcbiAgICAvLyB0aGlzIGlzIGEgd2VpcmQgaW50ZXJuYWwgdGhpbmcgdXNlZCBpbiB0aGUgb3Bsb2chKSBpcyB0aGUgc2FtZSBhcyB0aGVcbiAgICAvLyBNb25nbyByZXByZXNlbnRhdGlvbi4gV2UgbmVlZCB0byBkbyB0aGlzIGV4cGxpY2l0bHkgb3IgZWxzZSB3ZSB3b3VsZCBkbyBhXG4gICAgLy8gc3RydWN0dXJhbCBjbG9uZSBhbmQgbG9zZSB0aGUgcHJvdG90eXBlLlxuICAgIHJldHVybiBkb2N1bWVudDtcbiAgfVxuICBpZiAoRUpTT04uX2lzQ3VzdG9tVHlwZShkb2N1bWVudCkpIHtcbiAgICByZXR1cm4gcmVwbGFjZU5hbWVzKG1ha2VNb25nb0xlZ2FsLCBFSlNPTi50b0pTT05WYWx1ZShkb2N1bWVudCkpO1xuICB9XG4gIC8vIEl0IGlzIG5vdCBvcmRpbmFyaWx5IHBvc3NpYmxlIHRvIHN0aWNrIGRvbGxhci1zaWduIGtleXMgaW50byBtb25nb1xuICAvLyBzbyB3ZSBkb24ndCBib3RoZXIgY2hlY2tpbmcgZm9yIHRoaW5ncyB0aGF0IG5lZWQgZXNjYXBpbmcgYXQgdGhpcyB0aW1lLlxuICByZXR1cm4gdW5kZWZpbmVkO1xufTtcblxudmFyIHJlcGxhY2VUeXBlcyA9IGZ1bmN0aW9uIChkb2N1bWVudCwgYXRvbVRyYW5zZm9ybWVyKSB7XG4gIGlmICh0eXBlb2YgZG9jdW1lbnQgIT09ICdvYmplY3QnIHx8IGRvY3VtZW50ID09PSBudWxsKVxuICAgIHJldHVybiBkb2N1bWVudDtcblxuICB2YXIgcmVwbGFjZWRUb3BMZXZlbEF0b20gPSBhdG9tVHJhbnNmb3JtZXIoZG9jdW1lbnQpO1xuICBpZiAocmVwbGFjZWRUb3BMZXZlbEF0b20gIT09IHVuZGVmaW5lZClcbiAgICByZXR1cm4gcmVwbGFjZWRUb3BMZXZlbEF0b207XG5cbiAgdmFyIHJldCA9IGRvY3VtZW50O1xuICBfLmVhY2goZG9jdW1lbnQsIGZ1bmN0aW9uICh2YWwsIGtleSkge1xuICAgIHZhciB2YWxSZXBsYWNlZCA9IHJlcGxhY2VUeXBlcyh2YWwsIGF0b21UcmFuc2Zvcm1lcik7XG4gICAgaWYgKHZhbCAhPT0gdmFsUmVwbGFjZWQpIHtcbiAgICAgIC8vIExhenkgY2xvbmUuIFNoYWxsb3cgY29weS5cbiAgICAgIGlmIChyZXQgPT09IGRvY3VtZW50KVxuICAgICAgICByZXQgPSBfLmNsb25lKGRvY3VtZW50KTtcbiAgICAgIHJldFtrZXldID0gdmFsUmVwbGFjZWQ7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIHJldDtcbn07XG5cblxuTW9uZ29Db25uZWN0aW9uID0gZnVuY3Rpb24gKHVybCwgb3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICBzZWxmLl9vYnNlcnZlTXVsdGlwbGV4ZXJzID0ge307XG4gIHNlbGYuX29uRmFpbG92ZXJIb29rID0gbmV3IEhvb2s7XG5cbiAgdmFyIG1vbmdvT3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe1xuICAgIC8vIFJlY29ubmVjdCBvbiBlcnJvci5cbiAgICBhdXRvUmVjb25uZWN0OiB0cnVlLFxuICAgIC8vIFRyeSB0byByZWNvbm5lY3QgZm9yZXZlciwgaW5zdGVhZCBvZiBzdG9wcGluZyBhZnRlciAzMCB0cmllcyAodGhlXG4gICAgLy8gZGVmYXVsdCksIHdpdGggZWFjaCBhdHRlbXB0IHNlcGFyYXRlZCBieSAxMDAwbXMuXG4gICAgcmVjb25uZWN0VHJpZXM6IEluZmluaXR5LFxuICAgIGlnbm9yZVVuZGVmaW5lZDogdHJ1ZVxuICB9LCBNb25nby5fY29ubmVjdGlvbk9wdGlvbnMpO1xuXG4gIC8vIERpc2FibGUgdGhlIG5hdGl2ZSBwYXJzZXIgYnkgZGVmYXVsdCwgdW5sZXNzIHNwZWNpZmljYWxseSBlbmFibGVkXG4gIC8vIGluIHRoZSBtb25nbyBVUkwuXG4gIC8vIC0gVGhlIG5hdGl2ZSBkcml2ZXIgY2FuIGNhdXNlIGVycm9ycyB3aGljaCBub3JtYWxseSB3b3VsZCBiZVxuICAvLyAgIHRocm93biwgY2F1Z2h0LCBhbmQgaGFuZGxlZCBpbnRvIHNlZ2ZhdWx0cyB0aGF0IHRha2UgZG93biB0aGVcbiAgLy8gICB3aG9sZSBhcHAuXG4gIC8vIC0gQmluYXJ5IG1vZHVsZXMgZG9uJ3QgeWV0IHdvcmsgd2hlbiB5b3UgYnVuZGxlIGFuZCBtb3ZlIHRoZSBidW5kbGVcbiAgLy8gICB0byBhIGRpZmZlcmVudCBwbGF0Zm9ybSAoYWthIGRlcGxveSlcbiAgLy8gV2Ugc2hvdWxkIHJldmlzaXQgdGhpcyBhZnRlciBiaW5hcnkgbnBtIG1vZHVsZSBzdXBwb3J0IGxhbmRzLlxuICBpZiAoISgvW1xcPyZdbmF0aXZlXz9bcFBdYXJzZXI9Ly50ZXN0KHVybCkpKSB7XG4gICAgbW9uZ29PcHRpb25zLm5hdGl2ZV9wYXJzZXIgPSBmYWxzZTtcbiAgfVxuXG4gIC8vIEludGVybmFsbHkgdGhlIG9wbG9nIGNvbm5lY3Rpb25zIHNwZWNpZnkgdGhlaXIgb3duIHBvb2xTaXplXG4gIC8vIHdoaWNoIHdlIGRvbid0IHdhbnQgdG8gb3ZlcndyaXRlIHdpdGggYW55IHVzZXIgZGVmaW5lZCB2YWx1ZVxuICBpZiAoXy5oYXMob3B0aW9ucywgJ3Bvb2xTaXplJykpIHtcbiAgICAvLyBJZiB3ZSBqdXN0IHNldCB0aGlzIGZvciBcInNlcnZlclwiLCByZXBsU2V0IHdpbGwgb3ZlcnJpZGUgaXQuIElmIHdlIGp1c3RcbiAgICAvLyBzZXQgaXQgZm9yIHJlcGxTZXQsIGl0IHdpbGwgYmUgaWdub3JlZCBpZiB3ZSdyZSBub3QgdXNpbmcgYSByZXBsU2V0LlxuICAgIG1vbmdvT3B0aW9ucy5wb29sU2l6ZSA9IG9wdGlvbnMucG9vbFNpemU7XG4gIH1cblxuICBzZWxmLmRiID0gbnVsbDtcbiAgLy8gV2Uga2VlcCB0cmFjayBvZiB0aGUgUmVwbFNldCdzIHByaW1hcnksIHNvIHRoYXQgd2UgY2FuIHRyaWdnZXIgaG9va3Mgd2hlblxuICAvLyBpdCBjaGFuZ2VzLiAgVGhlIE5vZGUgZHJpdmVyJ3Mgam9pbmVkIGNhbGxiYWNrIHNlZW1zIHRvIGZpcmUgd2F5IHRvb1xuICAvLyBvZnRlbiwgd2hpY2ggaXMgd2h5IHdlIG5lZWQgdG8gdHJhY2sgaXQgb3Vyc2VsdmVzLlxuICBzZWxmLl9wcmltYXJ5ID0gbnVsbDtcbiAgc2VsZi5fb3Bsb2dIYW5kbGUgPSBudWxsO1xuICBzZWxmLl9kb2NGZXRjaGVyID0gbnVsbDtcblxuXG4gIHZhciBjb25uZWN0RnV0dXJlID0gbmV3IEZ1dHVyZTtcbiAgTW9uZ29EQi5jb25uZWN0KFxuICAgIHVybCxcbiAgICBtb25nb09wdGlvbnMsXG4gICAgTWV0ZW9yLmJpbmRFbnZpcm9ubWVudChcbiAgICAgIGZ1bmN0aW9uIChlcnIsIGRiKSB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaXJzdCwgZmlndXJlIG91dCB3aGF0IHRoZSBjdXJyZW50IHByaW1hcnkgaXMsIGlmIGFueS5cbiAgICAgICAgaWYgKGRiLnNlcnZlckNvbmZpZy5pc01hc3RlckRvYykge1xuICAgICAgICAgIHNlbGYuX3ByaW1hcnkgPSBkYi5zZXJ2ZXJDb25maWcuaXNNYXN0ZXJEb2MucHJpbWFyeTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRiLnNlcnZlckNvbmZpZy5vbihcbiAgICAgICAgICAnam9pbmVkJywgTWV0ZW9yLmJpbmRFbnZpcm9ubWVudChmdW5jdGlvbiAoa2luZCwgZG9jKSB7XG4gICAgICAgICAgICBpZiAoa2luZCA9PT0gJ3ByaW1hcnknKSB7XG4gICAgICAgICAgICAgIGlmIChkb2MucHJpbWFyeSAhPT0gc2VsZi5fcHJpbWFyeSkge1xuICAgICAgICAgICAgICAgIHNlbGYuX3ByaW1hcnkgPSBkb2MucHJpbWFyeTtcbiAgICAgICAgICAgICAgICBzZWxmLl9vbkZhaWxvdmVySG9vay5lYWNoKGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGRvYy5tZSA9PT0gc2VsZi5fcHJpbWFyeSkge1xuICAgICAgICAgICAgICAvLyBUaGUgdGhpbmcgd2UgdGhvdWdodCB3YXMgcHJpbWFyeSBpcyBub3cgc29tZXRoaW5nIG90aGVyIHRoYW5cbiAgICAgICAgICAgICAgLy8gcHJpbWFyeS4gIEZvcmdldCB0aGF0IHdlIHRob3VnaHQgaXQgd2FzIHByaW1hcnkuICAoVGhpcyBtZWFuc1xuICAgICAgICAgICAgICAvLyB0aGF0IGlmIGEgc2VydmVyIHN0b3BzIGJlaW5nIHByaW1hcnkgYW5kIHRoZW4gc3RhcnRzIGJlaW5nXG4gICAgICAgICAgICAgIC8vIHByaW1hcnkgYWdhaW4gd2l0aG91dCBhbm90aGVyIHNlcnZlciBiZWNvbWluZyBwcmltYXJ5IGluIHRoZVxuICAgICAgICAgICAgICAvLyBtaWRkbGUsIHdlJ2xsIGNvcnJlY3RseSBjb3VudCBpdCBhcyBhIGZhaWxvdmVyLilcbiAgICAgICAgICAgICAgc2VsZi5fcHJpbWFyeSA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSkpO1xuXG4gICAgICAgIC8vIEFsbG93IHRoZSBjb25zdHJ1Y3RvciB0byByZXR1cm4uXG4gICAgICAgIGNvbm5lY3RGdXR1cmVbJ3JldHVybiddKGRiKTtcbiAgICAgIH0sXG4gICAgICBjb25uZWN0RnV0dXJlLnJlc29sdmVyKCkgIC8vIG9uRXhjZXB0aW9uXG4gICAgKVxuICApO1xuXG4gIC8vIFdhaXQgZm9yIHRoZSBjb25uZWN0aW9uIHRvIGJlIHN1Y2Nlc3NmdWw7IHRocm93cyBvbiBmYWlsdXJlLlxuICBzZWxmLmRiID0gY29ubmVjdEZ1dHVyZS53YWl0KCk7XG5cbiAgaWYgKG9wdGlvbnMub3Bsb2dVcmwgJiYgISBQYWNrYWdlWydkaXNhYmxlLW9wbG9nJ10pIHtcbiAgICBzZWxmLl9vcGxvZ0hhbmRsZSA9IG5ldyBPcGxvZ0hhbmRsZShvcHRpb25zLm9wbG9nVXJsLCBzZWxmLmRiLmRhdGFiYXNlTmFtZSk7XG4gICAgc2VsZi5fZG9jRmV0Y2hlciA9IG5ldyBEb2NGZXRjaGVyKHNlbGYpO1xuICB9XG59O1xuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24oKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBpZiAoISBzZWxmLmRiKVxuICAgIHRocm93IEVycm9yKFwiY2xvc2UgY2FsbGVkIGJlZm9yZSBDb25uZWN0aW9uIGNyZWF0ZWQ/XCIpO1xuXG4gIC8vIFhYWCBwcm9iYWJseSB1bnRlc3RlZFxuICB2YXIgb3Bsb2dIYW5kbGUgPSBzZWxmLl9vcGxvZ0hhbmRsZTtcbiAgc2VsZi5fb3Bsb2dIYW5kbGUgPSBudWxsO1xuICBpZiAob3Bsb2dIYW5kbGUpXG4gICAgb3Bsb2dIYW5kbGUuc3RvcCgpO1xuXG4gIC8vIFVzZSBGdXR1cmUud3JhcCBzbyB0aGF0IGVycm9ycyBnZXQgdGhyb3duLiBUaGlzIGhhcHBlbnMgdG9cbiAgLy8gd29yayBldmVuIG91dHNpZGUgYSBmaWJlciBzaW5jZSB0aGUgJ2Nsb3NlJyBtZXRob2QgaXMgbm90XG4gIC8vIGFjdHVhbGx5IGFzeW5jaHJvbm91cy5cbiAgRnV0dXJlLndyYXAoXy5iaW5kKHNlbGYuZGIuY2xvc2UsIHNlbGYuZGIpKSh0cnVlKS53YWl0KCk7XG59O1xuXG4vLyBSZXR1cm5zIHRoZSBNb25nbyBDb2xsZWN0aW9uIG9iamVjdDsgbWF5IHlpZWxkLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5yYXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBpZiAoISBzZWxmLmRiKVxuICAgIHRocm93IEVycm9yKFwicmF3Q29sbGVjdGlvbiBjYWxsZWQgYmVmb3JlIENvbm5lY3Rpb24gY3JlYXRlZD9cIik7XG5cbiAgdmFyIGZ1dHVyZSA9IG5ldyBGdXR1cmU7XG4gIHNlbGYuZGIuY29sbGVjdGlvbihjb2xsZWN0aW9uTmFtZSwgZnV0dXJlLnJlc29sdmVyKCkpO1xuICByZXR1cm4gZnV0dXJlLndhaXQoKTtcbn07XG5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX2NyZWF0ZUNhcHBlZENvbGxlY3Rpb24gPSBmdW5jdGlvbiAoXG4gICAgY29sbGVjdGlvbk5hbWUsIGJ5dGVTaXplLCBtYXhEb2N1bWVudHMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIGlmICghIHNlbGYuZGIpXG4gICAgdGhyb3cgRXJyb3IoXCJfY3JlYXRlQ2FwcGVkQ29sbGVjdGlvbiBjYWxsZWQgYmVmb3JlIENvbm5lY3Rpb24gY3JlYXRlZD9cIik7XG5cbiAgdmFyIGZ1dHVyZSA9IG5ldyBGdXR1cmUoKTtcbiAgc2VsZi5kYi5jcmVhdGVDb2xsZWN0aW9uKFxuICAgIGNvbGxlY3Rpb25OYW1lLFxuICAgIHsgY2FwcGVkOiB0cnVlLCBzaXplOiBieXRlU2l6ZSwgbWF4OiBtYXhEb2N1bWVudHMgfSxcbiAgICBmdXR1cmUucmVzb2x2ZXIoKSk7XG4gIGZ1dHVyZS53YWl0KCk7XG59O1xuXG4vLyBUaGlzIHNob3VsZCBiZSBjYWxsZWQgc3luY2hyb25vdXNseSB3aXRoIGEgd3JpdGUsIHRvIGNyZWF0ZSBhXG4vLyB0cmFuc2FjdGlvbiBvbiB0aGUgY3VycmVudCB3cml0ZSBmZW5jZSwgaWYgYW55LiBBZnRlciB3ZSBjYW4gcmVhZFxuLy8gdGhlIHdyaXRlLCBhbmQgYWZ0ZXIgb2JzZXJ2ZXJzIGhhdmUgYmVlbiBub3RpZmllZCAob3IgYXQgbGVhc3QsXG4vLyBhZnRlciB0aGUgb2JzZXJ2ZXIgbm90aWZpZXJzIGhhdmUgYWRkZWQgdGhlbXNlbHZlcyB0byB0aGUgd3JpdGVcbi8vIGZlbmNlKSwgeW91IHNob3VsZCBjYWxsICdjb21taXR0ZWQoKScgb24gdGhlIG9iamVjdCByZXR1cm5lZC5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX21heWJlQmVnaW5Xcml0ZSA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIGZlbmNlID0gRERQU2VydmVyLl9DdXJyZW50V3JpdGVGZW5jZS5nZXQoKTtcbiAgaWYgKGZlbmNlKSB7XG4gICAgcmV0dXJuIGZlbmNlLmJlZ2luV3JpdGUoKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4ge2NvbW1pdHRlZDogZnVuY3Rpb24gKCkge319O1xuICB9XG59O1xuXG4vLyBJbnRlcm5hbCBpbnRlcmZhY2U6IGFkZHMgYSBjYWxsYmFjayB3aGljaCBpcyBjYWxsZWQgd2hlbiB0aGUgTW9uZ28gcHJpbWFyeVxuLy8gY2hhbmdlcy4gUmV0dXJucyBhIHN0b3AgaGFuZGxlLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fb25GYWlsb3ZlciA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICByZXR1cm4gdGhpcy5fb25GYWlsb3Zlckhvb2sucmVnaXN0ZXIoY2FsbGJhY2spO1xufTtcblxuXG4vLy8vLy8vLy8vLy8gUHVibGljIEFQSSAvLy8vLy8vLy8vXG5cbi8vIFRoZSB3cml0ZSBtZXRob2RzIGJsb2NrIHVudGlsIHRoZSBkYXRhYmFzZSBoYXMgY29uZmlybWVkIHRoZSB3cml0ZSAoaXQgbWF5XG4vLyBub3QgYmUgcmVwbGljYXRlZCBvciBzdGFibGUgb24gZGlzaywgYnV0IG9uZSBzZXJ2ZXIgaGFzIGNvbmZpcm1lZCBpdCkgaWYgbm9cbi8vIGNhbGxiYWNrIGlzIHByb3ZpZGVkLiBJZiBhIGNhbGxiYWNrIGlzIHByb3ZpZGVkLCB0aGVuIHRoZXkgY2FsbCB0aGUgY2FsbGJhY2tcbi8vIHdoZW4gdGhlIHdyaXRlIGlzIGNvbmZpcm1lZC4gVGhleSByZXR1cm4gbm90aGluZyBvbiBzdWNjZXNzLCBhbmQgcmFpc2UgYW5cbi8vIGV4Y2VwdGlvbiBvbiBmYWlsdXJlLlxuLy9cbi8vIEFmdGVyIG1ha2luZyBhIHdyaXRlICh3aXRoIGluc2VydCwgdXBkYXRlLCByZW1vdmUpLCBvYnNlcnZlcnMgYXJlXG4vLyBub3RpZmllZCBhc3luY2hyb25vdXNseS4gSWYgeW91IHdhbnQgdG8gcmVjZWl2ZSBhIGNhbGxiYWNrIG9uY2UgYWxsXG4vLyBvZiB0aGUgb2JzZXJ2ZXIgbm90aWZpY2F0aW9ucyBoYXZlIGxhbmRlZCBmb3IgeW91ciB3cml0ZSwgZG8gdGhlXG4vLyB3cml0ZXMgaW5zaWRlIGEgd3JpdGUgZmVuY2UgKHNldCBERFBTZXJ2ZXIuX0N1cnJlbnRXcml0ZUZlbmNlIHRvIGEgbmV3XG4vLyBfV3JpdGVGZW5jZSwgYW5kIHRoZW4gc2V0IGEgY2FsbGJhY2sgb24gdGhlIHdyaXRlIGZlbmNlLilcbi8vXG4vLyBTaW5jZSBvdXIgZXhlY3V0aW9uIGVudmlyb25tZW50IGlzIHNpbmdsZS10aHJlYWRlZCwgdGhpcyBpc1xuLy8gd2VsbC1kZWZpbmVkIC0tIGEgd3JpdGUgXCJoYXMgYmVlbiBtYWRlXCIgaWYgaXQncyByZXR1cm5lZCwgYW5kIGFuXG4vLyBvYnNlcnZlciBcImhhcyBiZWVuIG5vdGlmaWVkXCIgaWYgaXRzIGNhbGxiYWNrIGhhcyByZXR1cm5lZC5cblxudmFyIHdyaXRlQ2FsbGJhY2sgPSBmdW5jdGlvbiAod3JpdGUsIHJlZnJlc2gsIGNhbGxiYWNrKSB7XG4gIHJldHVybiBmdW5jdGlvbiAoZXJyLCByZXN1bHQpIHtcbiAgICBpZiAoISBlcnIpIHtcbiAgICAgIC8vIFhYWCBXZSBkb24ndCBoYXZlIHRvIHJ1biB0aGlzIG9uIGVycm9yLCByaWdodD9cbiAgICAgIHRyeSB7XG4gICAgICAgIHJlZnJlc2goKTtcbiAgICAgIH0gY2F0Y2ggKHJlZnJlc2hFcnIpIHtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgY2FsbGJhY2socmVmcmVzaEVycik7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IHJlZnJlc2hFcnI7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgd3JpdGUuY29tbWl0dGVkKCk7XG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICBjYWxsYmFjayhlcnIsIHJlc3VsdCk7XG4gICAgfSBlbHNlIGlmIChlcnIpIHtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH07XG59O1xuXG52YXIgYmluZEVudmlyb25tZW50Rm9yV3JpdGUgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgcmV0dXJuIE1ldGVvci5iaW5kRW52aXJvbm1lbnQoY2FsbGJhY2ssIFwiTW9uZ28gd3JpdGVcIik7XG59O1xuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLl9pbnNlcnQgPSBmdW5jdGlvbiAoY29sbGVjdGlvbl9uYW1lLCBkb2N1bWVudCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFjaykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgdmFyIHNlbmRFcnJvciA9IGZ1bmN0aW9uIChlKSB7XG4gICAgaWYgKGNhbGxiYWNrKVxuICAgICAgcmV0dXJuIGNhbGxiYWNrKGUpO1xuICAgIHRocm93IGU7XG4gIH07XG5cbiAgaWYgKGNvbGxlY3Rpb25fbmFtZSA9PT0gXCJfX19tZXRlb3JfZmFpbHVyZV90ZXN0X2NvbGxlY3Rpb25cIikge1xuICAgIHZhciBlID0gbmV3IEVycm9yKFwiRmFpbHVyZSB0ZXN0XCIpO1xuICAgIGUuX2V4cGVjdGVkQnlUZXN0ID0gdHJ1ZTtcbiAgICBzZW5kRXJyb3IoZSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKCEoTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0KGRvY3VtZW50KSAmJlxuICAgICAgICAhRUpTT04uX2lzQ3VzdG9tVHlwZShkb2N1bWVudCkpKSB7XG4gICAgc2VuZEVycm9yKG5ldyBFcnJvcihcbiAgICAgIFwiT25seSBwbGFpbiBvYmplY3RzIG1heSBiZSBpbnNlcnRlZCBpbnRvIE1vbmdvREJcIikpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHZhciB3cml0ZSA9IHNlbGYuX21heWJlQmVnaW5Xcml0ZSgpO1xuICB2YXIgcmVmcmVzaCA9IGZ1bmN0aW9uICgpIHtcbiAgICBNZXRlb3IucmVmcmVzaCh7Y29sbGVjdGlvbjogY29sbGVjdGlvbl9uYW1lLCBpZDogZG9jdW1lbnQuX2lkIH0pO1xuICB9O1xuICBjYWxsYmFjayA9IGJpbmRFbnZpcm9ubWVudEZvcldyaXRlKHdyaXRlQ2FsbGJhY2sod3JpdGUsIHJlZnJlc2gsIGNhbGxiYWNrKSk7XG4gIHRyeSB7XG4gICAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLnJhd0NvbGxlY3Rpb24oY29sbGVjdGlvbl9uYW1lKTtcbiAgICBjb2xsZWN0aW9uLmluc2VydChyZXBsYWNlVHlwZXMoZG9jdW1lbnQsIHJlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvKSxcbiAgICAgICAgICAgICAgICAgICAgICB7c2FmZTogdHJ1ZX0sIGNhbGxiYWNrKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgd3JpdGUuY29tbWl0dGVkKCk7XG4gICAgdGhyb3cgZXJyO1xuICB9XG59O1xuXG4vLyBDYXVzZSBxdWVyaWVzIHRoYXQgbWF5IGJlIGFmZmVjdGVkIGJ5IHRoZSBzZWxlY3RvciB0byBwb2xsIGluIHRoaXMgd3JpdGVcbi8vIGZlbmNlLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fcmVmcmVzaCA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgc2VsZWN0b3IpIHtcbiAgdmFyIHJlZnJlc2hLZXkgPSB7Y29sbGVjdGlvbjogY29sbGVjdGlvbk5hbWV9O1xuICAvLyBJZiB3ZSBrbm93IHdoaWNoIGRvY3VtZW50cyB3ZSdyZSByZW1vdmluZywgZG9uJ3QgcG9sbCBxdWVyaWVzIHRoYXQgYXJlXG4gIC8vIHNwZWNpZmljIHRvIG90aGVyIGRvY3VtZW50cy4gKE5vdGUgdGhhdCBtdWx0aXBsZSBub3RpZmljYXRpb25zIGhlcmUgc2hvdWxkXG4gIC8vIG5vdCBjYXVzZSBtdWx0aXBsZSBwb2xscywgc2luY2UgYWxsIG91ciBsaXN0ZW5lciBpcyBkb2luZyBpcyBlbnF1ZXVlaW5nIGFcbiAgLy8gcG9sbC4pXG4gIHZhciBzcGVjaWZpY0lkcyA9IExvY2FsQ29sbGVjdGlvbi5faWRzTWF0Y2hlZEJ5U2VsZWN0b3Ioc2VsZWN0b3IpO1xuICBpZiAoc3BlY2lmaWNJZHMpIHtcbiAgICBfLmVhY2goc3BlY2lmaWNJZHMsIGZ1bmN0aW9uIChpZCkge1xuICAgICAgTWV0ZW9yLnJlZnJlc2goXy5leHRlbmQoe2lkOiBpZH0sIHJlZnJlc2hLZXkpKTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICBNZXRlb3IucmVmcmVzaChyZWZyZXNoS2V5KTtcbiAgfVxufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fcmVtb3ZlID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25fbmFtZSwgc2VsZWN0b3IsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIGlmIChjb2xsZWN0aW9uX25hbWUgPT09IFwiX19fbWV0ZW9yX2ZhaWx1cmVfdGVzdF9jb2xsZWN0aW9uXCIpIHtcbiAgICB2YXIgZSA9IG5ldyBFcnJvcihcIkZhaWx1cmUgdGVzdFwiKTtcbiAgICBlLl9leHBlY3RlZEJ5VGVzdCA9IHRydWU7XG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG5cbiAgdmFyIHdyaXRlID0gc2VsZi5fbWF5YmVCZWdpbldyaXRlKCk7XG4gIHZhciByZWZyZXNoID0gZnVuY3Rpb24gKCkge1xuICAgIHNlbGYuX3JlZnJlc2goY29sbGVjdGlvbl9uYW1lLCBzZWxlY3Rvcik7XG4gIH07XG4gIGNhbGxiYWNrID0gYmluZEVudmlyb25tZW50Rm9yV3JpdGUod3JpdGVDYWxsYmFjayh3cml0ZSwgcmVmcmVzaCwgY2FsbGJhY2spKTtcblxuICB0cnkge1xuICAgIHZhciBjb2xsZWN0aW9uID0gc2VsZi5yYXdDb2xsZWN0aW9uKGNvbGxlY3Rpb25fbmFtZSk7XG4gICAgdmFyIHdyYXBwZWRDYWxsYmFjayA9IGZ1bmN0aW9uKGVyciwgZHJpdmVyUmVzdWx0KSB7XG4gICAgICBjYWxsYmFjayhlcnIsIHRyYW5zZm9ybVJlc3VsdChkcml2ZXJSZXN1bHQpLm51bWJlckFmZmVjdGVkKTtcbiAgICB9O1xuICAgIGNvbGxlY3Rpb24ucmVtb3ZlKHJlcGxhY2VUeXBlcyhzZWxlY3RvciwgcmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28pLFxuICAgICAgICAgICAgICAgICAgICAgICB7c2FmZTogdHJ1ZX0sIHdyYXBwZWRDYWxsYmFjayk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHdyaXRlLmNvbW1pdHRlZCgpO1xuICAgIHRocm93IGVycjtcbiAgfVxufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fZHJvcENvbGxlY3Rpb24gPSBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGNiKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICB2YXIgd3JpdGUgPSBzZWxmLl9tYXliZUJlZ2luV3JpdGUoKTtcbiAgdmFyIHJlZnJlc2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgTWV0ZW9yLnJlZnJlc2goe2NvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLCBpZDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgZHJvcENvbGxlY3Rpb246IHRydWV9KTtcbiAgfTtcbiAgY2IgPSBiaW5kRW52aXJvbm1lbnRGb3JXcml0ZSh3cml0ZUNhbGxiYWNrKHdyaXRlLCByZWZyZXNoLCBjYikpO1xuXG4gIHRyeSB7XG4gICAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLnJhd0NvbGxlY3Rpb24oY29sbGVjdGlvbk5hbWUpO1xuICAgIGNvbGxlY3Rpb24uZHJvcChjYik7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB3cml0ZS5jb21taXR0ZWQoKTtcbiAgICB0aHJvdyBlO1xuICB9XG59O1xuXG4vLyBGb3IgdGVzdGluZyBvbmx5LiAgU2xpZ2h0bHkgYmV0dGVyIHRoYW4gYGMucmF3RGF0YWJhc2UoKS5kcm9wRGF0YWJhc2UoKWBcbi8vIGJlY2F1c2UgaXQgbGV0cyB0aGUgdGVzdCdzIGZlbmNlIHdhaXQgZm9yIGl0IHRvIGJlIGNvbXBsZXRlLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fZHJvcERhdGFiYXNlID0gZnVuY3Rpb24gKGNiKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICB2YXIgd3JpdGUgPSBzZWxmLl9tYXliZUJlZ2luV3JpdGUoKTtcbiAgdmFyIHJlZnJlc2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgTWV0ZW9yLnJlZnJlc2goeyBkcm9wRGF0YWJhc2U6IHRydWUgfSk7XG4gIH07XG4gIGNiID0gYmluZEVudmlyb25tZW50Rm9yV3JpdGUod3JpdGVDYWxsYmFjayh3cml0ZSwgcmVmcmVzaCwgY2IpKTtcblxuICB0cnkge1xuICAgIHNlbGYuZGIuZHJvcERhdGFiYXNlKGNiKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHdyaXRlLmNvbW1pdHRlZCgpO1xuICAgIHRocm93IGU7XG4gIH1cbn07XG5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX3VwZGF0ZSA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uX25hbWUsIHNlbGVjdG9yLCBtb2QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIGlmICghIGNhbGxiYWNrICYmIG9wdGlvbnMgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xuICAgIGNhbGxiYWNrID0gb3B0aW9ucztcbiAgICBvcHRpb25zID0gbnVsbDtcbiAgfVxuXG4gIGlmIChjb2xsZWN0aW9uX25hbWUgPT09IFwiX19fbWV0ZW9yX2ZhaWx1cmVfdGVzdF9jb2xsZWN0aW9uXCIpIHtcbiAgICB2YXIgZSA9IG5ldyBFcnJvcihcIkZhaWx1cmUgdGVzdFwiKTtcbiAgICBlLl9leHBlY3RlZEJ5VGVzdCA9IHRydWU7XG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG5cbiAgLy8gZXhwbGljaXQgc2FmZXR5IGNoZWNrLiBudWxsIGFuZCB1bmRlZmluZWQgY2FuIGNyYXNoIHRoZSBtb25nb1xuICAvLyBkcml2ZXIuIEFsdGhvdWdoIHRoZSBub2RlIGRyaXZlciBhbmQgbWluaW1vbmdvIGRvICdzdXBwb3J0J1xuICAvLyBub24tb2JqZWN0IG1vZGlmaWVyIGluIHRoYXQgdGhleSBkb24ndCBjcmFzaCwgdGhleSBhcmUgbm90XG4gIC8vIG1lYW5pbmdmdWwgb3BlcmF0aW9ucyBhbmQgZG8gbm90IGRvIGFueXRoaW5nLiBEZWZlbnNpdmVseSB0aHJvdyBhblxuICAvLyBlcnJvciBoZXJlLlxuICBpZiAoIW1vZCB8fCB0eXBlb2YgbW9kICE9PSAnb2JqZWN0JylcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIG1vZGlmaWVyLiBNb2RpZmllciBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG5cbiAgaWYgKCEoTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0KG1vZCkgJiZcbiAgICAgICAgIUVKU09OLl9pc0N1c3RvbVR5cGUobW9kKSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIk9ubHkgcGxhaW4gb2JqZWN0cyBtYXkgYmUgdXNlZCBhcyByZXBsYWNlbWVudFwiICtcbiAgICAgICAgXCIgZG9jdW1lbnRzIGluIE1vbmdvREJcIik7XG4gIH1cblxuICBpZiAoIW9wdGlvbnMpIG9wdGlvbnMgPSB7fTtcblxuICB2YXIgd3JpdGUgPSBzZWxmLl9tYXliZUJlZ2luV3JpdGUoKTtcbiAgdmFyIHJlZnJlc2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgc2VsZi5fcmVmcmVzaChjb2xsZWN0aW9uX25hbWUsIHNlbGVjdG9yKTtcbiAgfTtcbiAgY2FsbGJhY2sgPSB3cml0ZUNhbGxiYWNrKHdyaXRlLCByZWZyZXNoLCBjYWxsYmFjayk7XG4gIHRyeSB7XG4gICAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLnJhd0NvbGxlY3Rpb24oY29sbGVjdGlvbl9uYW1lKTtcbiAgICB2YXIgbW9uZ29PcHRzID0ge3NhZmU6IHRydWV9O1xuICAgIC8vIGV4cGxpY3RseSBlbnVtZXJhdGUgb3B0aW9ucyB0aGF0IG1pbmltb25nbyBzdXBwb3J0c1xuICAgIGlmIChvcHRpb25zLnVwc2VydCkgbW9uZ29PcHRzLnVwc2VydCA9IHRydWU7XG4gICAgaWYgKG9wdGlvbnMubXVsdGkpIG1vbmdvT3B0cy5tdWx0aSA9IHRydWU7XG4gICAgLy8gTGV0cyB5b3UgZ2V0IGEgbW9yZSBtb3JlIGZ1bGwgcmVzdWx0IGZyb20gTW9uZ29EQi4gVXNlIHdpdGggY2F1dGlvbjpcbiAgICAvLyBtaWdodCBub3Qgd29yayB3aXRoIEMudXBzZXJ0IChhcyBvcHBvc2VkIHRvIEMudXBkYXRlKHt1cHNlcnQ6dHJ1ZX0pIG9yXG4gICAgLy8gd2l0aCBzaW11bGF0ZWQgdXBzZXJ0LlxuICAgIGlmIChvcHRpb25zLmZ1bGxSZXN1bHQpIG1vbmdvT3B0cy5mdWxsUmVzdWx0ID0gdHJ1ZTtcblxuICAgIHZhciBtb25nb1NlbGVjdG9yID0gcmVwbGFjZVR5cGVzKHNlbGVjdG9yLCByZXBsYWNlTWV0ZW9yQXRvbVdpdGhNb25nbyk7XG4gICAgdmFyIG1vbmdvTW9kID0gcmVwbGFjZVR5cGVzKG1vZCwgcmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28pO1xuXG4gICAgdmFyIGlzTW9kaWZ5ID0gTG9jYWxDb2xsZWN0aW9uLl9pc01vZGlmaWNhdGlvbk1vZChtb25nb01vZCk7XG5cbiAgICBpZiAob3B0aW9ucy5fZm9yYmlkUmVwbGFjZSAmJiAhaXNNb2RpZnkpIHtcbiAgICAgIHZhciBlcnIgPSBuZXcgRXJyb3IoXCJJbnZhbGlkIG1vZGlmaWVyLiBSZXBsYWNlbWVudHMgYXJlIGZvcmJpZGRlbi5cIik7XG4gICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gV2UndmUgYWxyZWFkeSBydW4gcmVwbGFjZVR5cGVzL3JlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvIG9uXG4gICAgLy8gc2VsZWN0b3IgYW5kIG1vZC4gIFdlIGFzc3VtZSBpdCBkb2Vzbid0IG1hdHRlciwgYXMgZmFyIGFzXG4gICAgLy8gdGhlIGJlaGF2aW9yIG9mIG1vZGlmaWVycyBpcyBjb25jZXJuZWQsIHdoZXRoZXIgYF9tb2RpZnlgXG4gICAgLy8gaXMgcnVuIG9uIEVKU09OIG9yIG9uIG1vbmdvLWNvbnZlcnRlZCBFSlNPTi5cblxuICAgIC8vIFJ1biB0aGlzIGNvZGUgdXAgZnJvbnQgc28gdGhhdCBpdCBmYWlscyBmYXN0IGlmIHNvbWVvbmUgdXNlc1xuICAgIC8vIGEgTW9uZ28gdXBkYXRlIG9wZXJhdG9yIHdlIGRvbid0IHN1cHBvcnQuXG4gICAgbGV0IGtub3duSWQ7XG4gICAgaWYgKG9wdGlvbnMudXBzZXJ0KSB7XG4gICAgICB0cnkge1xuICAgICAgICBsZXQgbmV3RG9jID0gTG9jYWxDb2xsZWN0aW9uLl9jcmVhdGVVcHNlcnREb2N1bWVudChzZWxlY3RvciwgbW9kKTtcbiAgICAgICAga25vd25JZCA9IG5ld0RvYy5faWQ7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG9wdGlvbnMudXBzZXJ0ICYmXG4gICAgICAgICEgaXNNb2RpZnkgJiZcbiAgICAgICAgISBrbm93bklkICYmXG4gICAgICAgIG9wdGlvbnMuaW5zZXJ0ZWRJZCAmJlxuICAgICAgICAhIChvcHRpb25zLmluc2VydGVkSWQgaW5zdGFuY2VvZiBNb25nby5PYmplY3RJRCAmJlxuICAgICAgICAgICBvcHRpb25zLmdlbmVyYXRlZElkKSkge1xuICAgICAgLy8gSW4gY2FzZSBvZiBhbiB1cHNlcnQgd2l0aCBhIHJlcGxhY2VtZW50LCB3aGVyZSB0aGVyZSBpcyBubyBfaWQgZGVmaW5lZFxuICAgICAgLy8gaW4gZWl0aGVyIHRoZSBxdWVyeSBvciB0aGUgcmVwbGFjZW1lbnQgZG9jLCBtb25nbyB3aWxsIGdlbmVyYXRlIGFuIGlkIGl0c2VsZi5cbiAgICAgIC8vIFRoZXJlZm9yZSB3ZSBuZWVkIHRoaXMgc3BlY2lhbCBzdHJhdGVneSBpZiB3ZSB3YW50IHRvIGNvbnRyb2wgdGhlIGlkIG91cnNlbHZlcy5cblxuICAgICAgLy8gV2UgZG9uJ3QgbmVlZCB0byBkbyB0aGlzIHdoZW46XG4gICAgICAvLyAtIFRoaXMgaXMgbm90IGEgcmVwbGFjZW1lbnQsIHNvIHdlIGNhbiBhZGQgYW4gX2lkIHRvICRzZXRPbkluc2VydFxuICAgICAgLy8gLSBUaGUgaWQgaXMgZGVmaW5lZCBieSBxdWVyeSBvciBtb2Qgd2UgY2FuIGp1c3QgYWRkIGl0IHRvIHRoZSByZXBsYWNlbWVudCBkb2NcbiAgICAgIC8vIC0gVGhlIHVzZXIgZGlkIG5vdCBzcGVjaWZ5IGFueSBpZCBwcmVmZXJlbmNlIGFuZCB0aGUgaWQgaXMgYSBNb25nbyBPYmplY3RJZCxcbiAgICAgIC8vICAgICB0aGVuIHdlIGNhbiBqdXN0IGxldCBNb25nbyBnZW5lcmF0ZSB0aGUgaWRcblxuICAgICAgc2ltdWxhdGVVcHNlcnRXaXRoSW5zZXJ0ZWRJZChcbiAgICAgICAgY29sbGVjdGlvbiwgbW9uZ29TZWxlY3RvciwgbW9uZ29Nb2QsIG9wdGlvbnMsXG4gICAgICAgIC8vIFRoaXMgY2FsbGJhY2sgZG9lcyBub3QgbmVlZCB0byBiZSBiaW5kRW52aXJvbm1lbnQnZWQgYmVjYXVzZVxuICAgICAgICAvLyBzaW11bGF0ZVVwc2VydFdpdGhJbnNlcnRlZElkKCkgd3JhcHMgaXQgYW5kIHRoZW4gcGFzc2VzIGl0IHRocm91Z2hcbiAgICAgICAgLy8gYmluZEVudmlyb25tZW50Rm9yV3JpdGUuXG4gICAgICAgIGZ1bmN0aW9uIChlcnJvciwgcmVzdWx0KSB7XG4gICAgICAgICAgLy8gSWYgd2UgZ290IGhlcmUgdmlhIGEgdXBzZXJ0KCkgY2FsbCwgdGhlbiBvcHRpb25zLl9yZXR1cm5PYmplY3Qgd2lsbFxuICAgICAgICAgIC8vIGJlIHNldCBhbmQgd2Ugc2hvdWxkIHJldHVybiB0aGUgd2hvbGUgb2JqZWN0LiBPdGhlcndpc2UsIHdlIHNob3VsZFxuICAgICAgICAgIC8vIGp1c3QgcmV0dXJuIHRoZSBudW1iZXIgb2YgYWZmZWN0ZWQgZG9jcyB0byBtYXRjaCB0aGUgbW9uZ28gQVBJLlxuICAgICAgICAgIGlmIChyZXN1bHQgJiYgISBvcHRpb25zLl9yZXR1cm5PYmplY3QpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKGVycm9yLCByZXN1bHQubnVtYmVyQWZmZWN0ZWQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWxsYmFjayhlcnJvciwgcmVzdWx0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICk7XG4gICAgfSBlbHNlIHtcblxuICAgICAgaWYgKG9wdGlvbnMudXBzZXJ0ICYmICFrbm93bklkICYmIG9wdGlvbnMuaW5zZXJ0ZWRJZCAmJiBpc01vZGlmeSkge1xuICAgICAgICBpZiAoIW1vbmdvTW9kLmhhc093blByb3BlcnR5KCckc2V0T25JbnNlcnQnKSkge1xuICAgICAgICAgIG1vbmdvTW9kLiRzZXRPbkluc2VydCA9IHt9O1xuICAgICAgICB9XG4gICAgICAgIGtub3duSWQgPSBvcHRpb25zLmluc2VydGVkSWQ7XG4gICAgICAgIE9iamVjdC5hc3NpZ24obW9uZ29Nb2QuJHNldE9uSW5zZXJ0LCByZXBsYWNlVHlwZXMoe19pZDogb3B0aW9ucy5pbnNlcnRlZElkfSwgcmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28pKTtcbiAgICAgIH1cblxuICAgICAgY29sbGVjdGlvbi51cGRhdGUoXG4gICAgICAgIG1vbmdvU2VsZWN0b3IsIG1vbmdvTW9kLCBtb25nb09wdHMsXG4gICAgICAgIGJpbmRFbnZpcm9ubWVudEZvcldyaXRlKGZ1bmN0aW9uIChlcnIsIHJlc3VsdCkge1xuICAgICAgICAgIGlmICghIGVycikge1xuICAgICAgICAgICAgdmFyIG1ldGVvclJlc3VsdCA9IHRyYW5zZm9ybVJlc3VsdChyZXN1bHQpO1xuICAgICAgICAgICAgaWYgKG1ldGVvclJlc3VsdCAmJiBvcHRpb25zLl9yZXR1cm5PYmplY3QpIHtcbiAgICAgICAgICAgICAgLy8gSWYgdGhpcyB3YXMgYW4gdXBzZXJ0KCkgY2FsbCwgYW5kIHdlIGVuZGVkIHVwXG4gICAgICAgICAgICAgIC8vIGluc2VydGluZyBhIG5ldyBkb2MgYW5kIHdlIGtub3cgaXRzIGlkLCB0aGVuXG4gICAgICAgICAgICAgIC8vIHJldHVybiB0aGF0IGlkIGFzIHdlbGwuXG4gICAgICAgICAgICAgIGlmIChvcHRpb25zLnVwc2VydCAmJiBtZXRlb3JSZXN1bHQuaW5zZXJ0ZWRJZCkge1xuICAgICAgICAgICAgICAgIGlmIChrbm93bklkKSB7XG4gICAgICAgICAgICAgICAgICBtZXRlb3JSZXN1bHQuaW5zZXJ0ZWRJZCA9IGtub3duSWQ7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChtZXRlb3JSZXN1bHQuaW5zZXJ0ZWRJZCBpbnN0YW5jZW9mIE1vbmdvREIuT2JqZWN0SUQpIHtcbiAgICAgICAgICAgICAgICAgIG1ldGVvclJlc3VsdC5pbnNlcnRlZElkID0gbmV3IE1vbmdvLk9iamVjdElEKG1ldGVvclJlc3VsdC5pbnNlcnRlZElkLnRvSGV4U3RyaW5nKCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNhbGxiYWNrKGVyciwgbWV0ZW9yUmVzdWx0KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKGVyciwgbWV0ZW9yUmVzdWx0Lm51bWJlckFmZmVjdGVkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB3cml0ZS5jb21taXR0ZWQoKTtcbiAgICB0aHJvdyBlO1xuICB9XG59O1xuXG52YXIgdHJhbnNmb3JtUmVzdWx0ID0gZnVuY3Rpb24gKGRyaXZlclJlc3VsdCkge1xuICB2YXIgbWV0ZW9yUmVzdWx0ID0geyBudW1iZXJBZmZlY3RlZDogMCB9O1xuICBpZiAoZHJpdmVyUmVzdWx0KSB7XG4gICAgdmFyIG1vbmdvUmVzdWx0ID0gZHJpdmVyUmVzdWx0LnJlc3VsdDtcblxuICAgIC8vIE9uIHVwZGF0ZXMgd2l0aCB1cHNlcnQ6dHJ1ZSwgdGhlIGluc2VydGVkIHZhbHVlcyBjb21lIGFzIGEgbGlzdCBvZlxuICAgIC8vIHVwc2VydGVkIHZhbHVlcyAtLSBldmVuIHdpdGggb3B0aW9ucy5tdWx0aSwgd2hlbiB0aGUgdXBzZXJ0IGRvZXMgaW5zZXJ0LFxuICAgIC8vIGl0IG9ubHkgaW5zZXJ0cyBvbmUgZWxlbWVudC5cbiAgICBpZiAobW9uZ29SZXN1bHQudXBzZXJ0ZWQpIHtcbiAgICAgIG1ldGVvclJlc3VsdC5udW1iZXJBZmZlY3RlZCArPSBtb25nb1Jlc3VsdC51cHNlcnRlZC5sZW5ndGg7XG5cbiAgICAgIGlmIChtb25nb1Jlc3VsdC51cHNlcnRlZC5sZW5ndGggPT0gMSkge1xuICAgICAgICBtZXRlb3JSZXN1bHQuaW5zZXJ0ZWRJZCA9IG1vbmdvUmVzdWx0LnVwc2VydGVkWzBdLl9pZDtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbWV0ZW9yUmVzdWx0Lm51bWJlckFmZmVjdGVkID0gbW9uZ29SZXN1bHQubjtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbWV0ZW9yUmVzdWx0O1xufTtcblxuXG52YXIgTlVNX09QVElNSVNUSUNfVFJJRVMgPSAzO1xuXG4vLyBleHBvc2VkIGZvciB0ZXN0aW5nXG5Nb25nb0Nvbm5lY3Rpb24uX2lzQ2Fubm90Q2hhbmdlSWRFcnJvciA9IGZ1bmN0aW9uIChlcnIpIHtcblxuICAvLyBNb25nbyAzLjIuKiByZXR1cm5zIGVycm9yIGFzIG5leHQgT2JqZWN0OlxuICAvLyB7bmFtZTogU3RyaW5nLCBjb2RlOiBOdW1iZXIsIGVycm1zZzogU3RyaW5nfVxuICAvLyBPbGRlciBNb25nbyByZXR1cm5zOlxuICAvLyB7bmFtZTogU3RyaW5nLCBjb2RlOiBOdW1iZXIsIGVycjogU3RyaW5nfVxuICB2YXIgZXJyb3IgPSBlcnIuZXJybXNnIHx8IGVyci5lcnI7XG5cbiAgLy8gV2UgZG9uJ3QgdXNlIHRoZSBlcnJvciBjb2RlIGhlcmVcbiAgLy8gYmVjYXVzZSB0aGUgZXJyb3IgY29kZSB3ZSBvYnNlcnZlZCBpdCBwcm9kdWNpbmcgKDE2ODM3KSBhcHBlYXJzIHRvIGJlXG4gIC8vIGEgZmFyIG1vcmUgZ2VuZXJpYyBlcnJvciBjb2RlIGJhc2VkIG9uIGV4YW1pbmluZyB0aGUgc291cmNlLlxuICBpZiAoZXJyb3IuaW5kZXhPZignVGhlIF9pZCBmaWVsZCBjYW5ub3QgYmUgY2hhbmdlZCcpID09PSAwXG4gICAgfHwgZXJyb3IuaW5kZXhPZihcInRoZSAoaW1tdXRhYmxlKSBmaWVsZCAnX2lkJyB3YXMgZm91bmQgdG8gaGF2ZSBiZWVuIGFsdGVyZWQgdG8gX2lkXCIpICE9PSAtMSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxudmFyIHNpbXVsYXRlVXBzZXJ0V2l0aEluc2VydGVkSWQgPSBmdW5jdGlvbiAoY29sbGVjdGlvbiwgc2VsZWN0b3IsIG1vZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gIC8vIFNUUkFURUdZOiBGaXJzdCB0cnkgZG9pbmcgYW4gdXBzZXJ0IHdpdGggYSBnZW5lcmF0ZWQgSUQuXG4gIC8vIElmIHRoaXMgdGhyb3dzIGFuIGVycm9yIGFib3V0IGNoYW5naW5nIHRoZSBJRCBvbiBhbiBleGlzdGluZyBkb2N1bWVudFxuICAvLyB0aGVuIHdpdGhvdXQgYWZmZWN0aW5nIHRoZSBkYXRhYmFzZSwgd2Uga25vdyB3ZSBzaG91bGQgcHJvYmFibHkgdHJ5XG4gIC8vIGFuIHVwZGF0ZSB3aXRob3V0IHRoZSBnZW5lcmF0ZWQgSUQuIElmIGl0IGFmZmVjdGVkIDAgZG9jdW1lbnRzLFxuICAvLyB0aGVuIHdpdGhvdXQgYWZmZWN0aW5nIHRoZSBkYXRhYmFzZSwgd2UgdGhlIGRvY3VtZW50IHRoYXQgZmlyc3RcbiAgLy8gZ2F2ZSB0aGUgZXJyb3IgaXMgcHJvYmFibHkgcmVtb3ZlZCBhbmQgd2UgbmVlZCB0byB0cnkgYW4gaW5zZXJ0IGFnYWluXG4gIC8vIFdlIGdvIGJhY2sgdG8gc3RlcCBvbmUgYW5kIHJlcGVhdC5cbiAgLy8gTGlrZSBhbGwgXCJvcHRpbWlzdGljIHdyaXRlXCIgc2NoZW1lcywgd2UgcmVseSBvbiB0aGUgZmFjdCB0aGF0IGl0J3NcbiAgLy8gdW5saWtlbHkgb3VyIHdyaXRlcyB3aWxsIGNvbnRpbnVlIHRvIGJlIGludGVyZmVyZWQgd2l0aCB1bmRlciBub3JtYWxcbiAgLy8gY2lyY3Vtc3RhbmNlcyAodGhvdWdoIHN1ZmZpY2llbnRseSBoZWF2eSBjb250ZW50aW9uIHdpdGggd3JpdGVyc1xuICAvLyBkaXNhZ3JlZWluZyBvbiB0aGUgZXhpc3RlbmNlIG9mIGFuIG9iamVjdCB3aWxsIGNhdXNlIHdyaXRlcyB0byBmYWlsXG4gIC8vIGluIHRoZW9yeSkuXG5cbiAgdmFyIGluc2VydGVkSWQgPSBvcHRpb25zLmluc2VydGVkSWQ7IC8vIG11c3QgZXhpc3RcbiAgdmFyIG1vbmdvT3B0c0ZvclVwZGF0ZSA9IHtcbiAgICBzYWZlOiB0cnVlLFxuICAgIG11bHRpOiBvcHRpb25zLm11bHRpXG4gIH07XG4gIHZhciBtb25nb09wdHNGb3JJbnNlcnQgPSB7XG4gICAgc2FmZTogdHJ1ZSxcbiAgICB1cHNlcnQ6IHRydWVcbiAgfTtcblxuICB2YXIgcmVwbGFjZW1lbnRXaXRoSWQgPSBPYmplY3QuYXNzaWduKFxuICAgIHJlcGxhY2VUeXBlcyh7X2lkOiBpbnNlcnRlZElkfSwgcmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28pLFxuICAgIG1vZCk7XG5cbiAgdmFyIHRyaWVzID0gTlVNX09QVElNSVNUSUNfVFJJRVM7XG5cbiAgdmFyIGRvVXBkYXRlID0gZnVuY3Rpb24gKCkge1xuICAgIHRyaWVzLS07XG4gICAgaWYgKCEgdHJpZXMpIHtcbiAgICAgIGNhbGxiYWNrKG5ldyBFcnJvcihcIlVwc2VydCBmYWlsZWQgYWZ0ZXIgXCIgKyBOVU1fT1BUSU1JU1RJQ19UUklFUyArIFwiIHRyaWVzLlwiKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbGxlY3Rpb24udXBkYXRlKHNlbGVjdG9yLCBtb2QsIG1vbmdvT3B0c0ZvclVwZGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRFbnZpcm9ubWVudEZvcldyaXRlKGZ1bmN0aW9uIChlcnIsIHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChyZXN1bHQgJiYgcmVzdWx0LnJlc3VsdC5uICE9IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayhudWxsLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBudW1iZXJBZmZlY3RlZDogcmVzdWx0LnJlc3VsdC5uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZG9Db25kaXRpb25hbEluc2VydCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgfVxuICB9O1xuXG4gIHZhciBkb0NvbmRpdGlvbmFsSW5zZXJ0ID0gZnVuY3Rpb24gKCkge1xuICAgIGNvbGxlY3Rpb24udXBkYXRlKHNlbGVjdG9yLCByZXBsYWNlbWVudFdpdGhJZCwgbW9uZ29PcHRzRm9ySW5zZXJ0LFxuICAgICAgICAgICAgICAgICAgICAgIGJpbmRFbnZpcm9ubWVudEZvcldyaXRlKGZ1bmN0aW9uIChlcnIsIHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBmaWd1cmUgb3V0IGlmIHRoaXMgaXMgYVxuICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBcImNhbm5vdCBjaGFuZ2UgX2lkIG9mIGRvY3VtZW50XCIgZXJyb3IsIGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBpZiBzbywgdHJ5IGRvVXBkYXRlKCkgYWdhaW4sIHVwIHRvIDMgdGltZXMuXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChNb25nb0Nvbm5lY3Rpb24uX2lzQ2Fubm90Q2hhbmdlSWRFcnJvcihlcnIpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZG9VcGRhdGUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayhudWxsLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbnVtYmVyQWZmZWN0ZWQ6IHJlc3VsdC5yZXN1bHQudXBzZXJ0ZWQubGVuZ3RoLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluc2VydGVkSWQ6IGluc2VydGVkSWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgfTtcblxuICBkb1VwZGF0ZSgpO1xufTtcblxuXy5lYWNoKFtcImluc2VydFwiLCBcInVwZGF0ZVwiLCBcInJlbW92ZVwiLCBcImRyb3BDb2xsZWN0aW9uXCIsIFwiZHJvcERhdGFiYXNlXCJdLCBmdW5jdGlvbiAobWV0aG9kKSB7XG4gIE1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uICgvKiBhcmd1bWVudHMgKi8pIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIE1ldGVvci53cmFwQXN5bmMoc2VsZltcIl9cIiArIG1ldGhvZF0pLmFwcGx5KHNlbGYsIGFyZ3VtZW50cyk7XG4gIH07XG59KTtcblxuLy8gWFhYIE1vbmdvQ29ubmVjdGlvbi51cHNlcnQoKSBkb2VzIG5vdCByZXR1cm4gdGhlIGlkIG9mIHRoZSBpbnNlcnRlZCBkb2N1bWVudFxuLy8gdW5sZXNzIHlvdSBzZXQgaXQgZXhwbGljaXRseSBpbiB0aGUgc2VsZWN0b3Igb3IgbW9kaWZpZXIgKGFzIGEgcmVwbGFjZW1lbnRcbi8vIGRvYykuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLnVwc2VydCA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgc2VsZWN0b3IsIG1vZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKHR5cGVvZiBvcHRpb25zID09PSBcImZ1bmN0aW9uXCIgJiYgISBjYWxsYmFjaykge1xuICAgIGNhbGxiYWNrID0gb3B0aW9ucztcbiAgICBvcHRpb25zID0ge307XG4gIH1cblxuICByZXR1cm4gc2VsZi51cGRhdGUoY29sbGVjdGlvbk5hbWUsIHNlbGVjdG9yLCBtb2QsXG4gICAgICAgICAgICAgICAgICAgICBfLmV4dGVuZCh7fSwgb3B0aW9ucywge1xuICAgICAgICAgICAgICAgICAgICAgICB1cHNlcnQ6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgIF9yZXR1cm5PYmplY3Q6IHRydWVcbiAgICAgICAgICAgICAgICAgICAgIH0pLCBjYWxsYmFjayk7XG59O1xuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIHNlbGVjdG9yLCBvcHRpb25zKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSlcbiAgICBzZWxlY3RvciA9IHt9O1xuXG4gIHJldHVybiBuZXcgQ3Vyc29yKFxuICAgIHNlbGYsIG5ldyBDdXJzb3JEZXNjcmlwdGlvbihjb2xsZWN0aW9uTmFtZSwgc2VsZWN0b3IsIG9wdGlvbnMpKTtcbn07XG5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuZmluZE9uZSA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uX25hbWUsIHNlbGVjdG9yLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSlcbiAgICBzZWxlY3RvciA9IHt9O1xuXG4gIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICBvcHRpb25zLmxpbWl0ID0gMTtcbiAgcmV0dXJuIHNlbGYuZmluZChjb2xsZWN0aW9uX25hbWUsIHNlbGVjdG9yLCBvcHRpb25zKS5mZXRjaCgpWzBdO1xufTtcblxuLy8gV2UnbGwgYWN0dWFsbHkgZGVzaWduIGFuIGluZGV4IEFQSSBsYXRlci4gRm9yIG5vdywgd2UganVzdCBwYXNzIHRocm91Z2ggdG9cbi8vIE1vbmdvJ3MsIGJ1dCBtYWtlIGl0IHN5bmNocm9ub3VzLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fZW5zdXJlSW5kZXggPSBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGluZGV4LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgLy8gV2UgZXhwZWN0IHRoaXMgZnVuY3Rpb24gdG8gYmUgY2FsbGVkIGF0IHN0YXJ0dXAsIG5vdCBmcm9tIHdpdGhpbiBhIG1ldGhvZCxcbiAgLy8gc28gd2UgZG9uJ3QgaW50ZXJhY3Qgd2l0aCB0aGUgd3JpdGUgZmVuY2UuXG4gIHZhciBjb2xsZWN0aW9uID0gc2VsZi5yYXdDb2xsZWN0aW9uKGNvbGxlY3Rpb25OYW1lKTtcbiAgdmFyIGZ1dHVyZSA9IG5ldyBGdXR1cmU7XG4gIHZhciBpbmRleE5hbWUgPSBjb2xsZWN0aW9uLmVuc3VyZUluZGV4KGluZGV4LCBvcHRpb25zLCBmdXR1cmUucmVzb2x2ZXIoKSk7XG4gIGZ1dHVyZS53YWl0KCk7XG59O1xuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fZHJvcEluZGV4ID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBpbmRleCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgLy8gVGhpcyBmdW5jdGlvbiBpcyBvbmx5IHVzZWQgYnkgdGVzdCBjb2RlLCBub3Qgd2l0aGluIGEgbWV0aG9kLCBzbyB3ZSBkb24ndFxuICAvLyBpbnRlcmFjdCB3aXRoIHRoZSB3cml0ZSBmZW5jZS5cbiAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLnJhd0NvbGxlY3Rpb24oY29sbGVjdGlvbk5hbWUpO1xuICB2YXIgZnV0dXJlID0gbmV3IEZ1dHVyZTtcbiAgdmFyIGluZGV4TmFtZSA9IGNvbGxlY3Rpb24uZHJvcEluZGV4KGluZGV4LCBmdXR1cmUucmVzb2x2ZXIoKSk7XG4gIGZ1dHVyZS53YWl0KCk7XG59O1xuXG4vLyBDVVJTT1JTXG5cbi8vIFRoZXJlIGFyZSBzZXZlcmFsIGNsYXNzZXMgd2hpY2ggcmVsYXRlIHRvIGN1cnNvcnM6XG4vL1xuLy8gQ3Vyc29yRGVzY3JpcHRpb24gcmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIHVzZWQgdG8gY29uc3RydWN0IGEgY3Vyc29yOlxuLy8gY29sbGVjdGlvbk5hbWUsIHNlbGVjdG9yLCBhbmQgKGZpbmQpIG9wdGlvbnMuICBCZWNhdXNlIGl0IGlzIHVzZWQgYXMgYSBrZXlcbi8vIGZvciBjdXJzb3IgZGUtZHVwLCBldmVyeXRoaW5nIGluIGl0IHNob3VsZCBlaXRoZXIgYmUgSlNPTi1zdHJpbmdpZmlhYmxlIG9yXG4vLyBub3QgYWZmZWN0IG9ic2VydmVDaGFuZ2VzIG91dHB1dCAoZWcsIG9wdGlvbnMudHJhbnNmb3JtIGZ1bmN0aW9ucyBhcmUgbm90XG4vLyBzdHJpbmdpZmlhYmxlIGJ1dCBkbyBub3QgYWZmZWN0IG9ic2VydmVDaGFuZ2VzKS5cbi8vXG4vLyBTeW5jaHJvbm91c0N1cnNvciBpcyBhIHdyYXBwZXIgYXJvdW5kIGEgTW9uZ29EQiBjdXJzb3Jcbi8vIHdoaWNoIGluY2x1ZGVzIGZ1bGx5LXN5bmNocm9ub3VzIHZlcnNpb25zIG9mIGZvckVhY2gsIGV0Yy5cbi8vXG4vLyBDdXJzb3IgaXMgdGhlIGN1cnNvciBvYmplY3QgcmV0dXJuZWQgZnJvbSBmaW5kKCksIHdoaWNoIGltcGxlbWVudHMgdGhlXG4vLyBkb2N1bWVudGVkIE1vbmdvLkNvbGxlY3Rpb24gY3Vyc29yIEFQSS4gIEl0IHdyYXBzIGEgQ3Vyc29yRGVzY3JpcHRpb24gYW5kIGFcbi8vIFN5bmNocm9ub3VzQ3Vyc29yIChsYXppbHk6IGl0IGRvZXNuJ3QgY29udGFjdCBNb25nbyB1bnRpbCB5b3UgY2FsbCBhIG1ldGhvZFxuLy8gbGlrZSBmZXRjaCBvciBmb3JFYWNoIG9uIGl0KS5cbi8vXG4vLyBPYnNlcnZlSGFuZGxlIGlzIHRoZSBcIm9ic2VydmUgaGFuZGxlXCIgcmV0dXJuZWQgZnJvbSBvYnNlcnZlQ2hhbmdlcy4gSXQgaGFzIGFcbi8vIHJlZmVyZW5jZSB0byBhbiBPYnNlcnZlTXVsdGlwbGV4ZXIuXG4vL1xuLy8gT2JzZXJ2ZU11bHRpcGxleGVyIGFsbG93cyBtdWx0aXBsZSBpZGVudGljYWwgT2JzZXJ2ZUhhbmRsZXMgdG8gYmUgZHJpdmVuIGJ5IGFcbi8vIHNpbmdsZSBvYnNlcnZlIGRyaXZlci5cbi8vXG4vLyBUaGVyZSBhcmUgdHdvIFwib2JzZXJ2ZSBkcml2ZXJzXCIgd2hpY2ggZHJpdmUgT2JzZXJ2ZU11bHRpcGxleGVyczpcbi8vICAgLSBQb2xsaW5nT2JzZXJ2ZURyaXZlciBjYWNoZXMgdGhlIHJlc3VsdHMgb2YgYSBxdWVyeSBhbmQgcmVydW5zIGl0IHdoZW5cbi8vICAgICBuZWNlc3NhcnkuXG4vLyAgIC0gT3Bsb2dPYnNlcnZlRHJpdmVyIGZvbGxvd3MgdGhlIE1vbmdvIG9wZXJhdGlvbiBsb2cgdG8gZGlyZWN0bHkgb2JzZXJ2ZVxuLy8gICAgIGRhdGFiYXNlIGNoYW5nZXMuXG4vLyBCb3RoIGltcGxlbWVudGF0aW9ucyBmb2xsb3cgdGhlIHNhbWUgc2ltcGxlIGludGVyZmFjZTogd2hlbiB5b3UgY3JlYXRlIHRoZW0sXG4vLyB0aGV5IHN0YXJ0IHNlbmRpbmcgb2JzZXJ2ZUNoYW5nZXMgY2FsbGJhY2tzIChhbmQgYSByZWFkeSgpIGludm9jYXRpb24pIHRvXG4vLyB0aGVpciBPYnNlcnZlTXVsdGlwbGV4ZXIsIGFuZCB5b3Ugc3RvcCB0aGVtIGJ5IGNhbGxpbmcgdGhlaXIgc3RvcCgpIG1ldGhvZC5cblxuQ3Vyc29yRGVzY3JpcHRpb24gPSBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIHNlbGVjdG9yLCBvcHRpb25zKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5jb2xsZWN0aW9uTmFtZSA9IGNvbGxlY3Rpb25OYW1lO1xuICBzZWxmLnNlbGVjdG9yID0gTW9uZ28uQ29sbGVjdGlvbi5fcmV3cml0ZVNlbGVjdG9yKHNlbGVjdG9yKTtcbiAgc2VsZi5vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbn07XG5cbkN1cnNvciA9IGZ1bmN0aW9uIChtb25nbywgY3Vyc29yRGVzY3JpcHRpb24pIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIHNlbGYuX21vbmdvID0gbW9uZ287XG4gIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uID0gY3Vyc29yRGVzY3JpcHRpb247XG4gIHNlbGYuX3N5bmNocm9ub3VzQ3Vyc29yID0gbnVsbDtcbn07XG5cbl8uZWFjaChbJ2ZvckVhY2gnLCAnbWFwJywgJ2ZldGNoJywgJ2NvdW50J10sIGZ1bmN0aW9uIChtZXRob2QpIHtcbiAgQ3Vyc29yLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIC8vIFlvdSBjYW4gb25seSBvYnNlcnZlIGEgdGFpbGFibGUgY3Vyc29yLlxuICAgIGlmIChzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnRhaWxhYmxlKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGNhbGwgXCIgKyBtZXRob2QgKyBcIiBvbiBhIHRhaWxhYmxlIGN1cnNvclwiKTtcblxuICAgIGlmICghc2VsZi5fc3luY2hyb25vdXNDdXJzb3IpIHtcbiAgICAgIHNlbGYuX3N5bmNocm9ub3VzQ3Vyc29yID0gc2VsZi5fbW9uZ28uX2NyZWF0ZVN5bmNocm9ub3VzQ3Vyc29yKFxuICAgICAgICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbiwge1xuICAgICAgICAgIC8vIE1ha2Ugc3VyZSB0aGF0IHRoZSBcInNlbGZcIiBhcmd1bWVudCB0byBmb3JFYWNoL21hcCBjYWxsYmFja3MgaXMgdGhlXG4gICAgICAgICAgLy8gQ3Vyc29yLCBub3QgdGhlIFN5bmNocm9ub3VzQ3Vyc29yLlxuICAgICAgICAgIHNlbGZGb3JJdGVyYXRpb246IHNlbGYsXG4gICAgICAgICAgdXNlVHJhbnNmb3JtOiB0cnVlXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBzZWxmLl9zeW5jaHJvbm91c0N1cnNvclttZXRob2RdLmFwcGx5KFxuICAgICAgc2VsZi5fc3luY2hyb25vdXNDdXJzb3IsIGFyZ3VtZW50cyk7XG4gIH07XG59KTtcblxuLy8gU2luY2Ugd2UgZG9uJ3QgYWN0dWFsbHkgaGF2ZSBhIFwibmV4dE9iamVjdFwiIGludGVyZmFjZSwgdGhlcmUncyByZWFsbHkgbm9cbi8vIHJlYXNvbiB0byBoYXZlIGEgXCJyZXdpbmRcIiBpbnRlcmZhY2UuICBBbGwgaXQgZGlkIHdhcyBtYWtlIG11bHRpcGxlIGNhbGxzXG4vLyB0byBmZXRjaC9tYXAvZm9yRWFjaCByZXR1cm4gbm90aGluZyB0aGUgc2Vjb25kIHRpbWUuXG4vLyBYWFggQ09NUEFUIFdJVEggMC44LjFcbkN1cnNvci5wcm90b3R5cGUucmV3aW5kID0gZnVuY3Rpb24gKCkge1xufTtcblxuQ3Vyc29yLnByb3RvdHlwZS5nZXRUcmFuc2Zvcm0gPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiB0aGlzLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnRyYW5zZm9ybTtcbn07XG5cbi8vIFdoZW4geW91IGNhbGwgTWV0ZW9yLnB1Ymxpc2goKSB3aXRoIGEgZnVuY3Rpb24gdGhhdCByZXR1cm5zIGEgQ3Vyc29yLCB3ZSBuZWVkXG4vLyB0byB0cmFuc211dGUgaXQgaW50byB0aGUgZXF1aXZhbGVudCBzdWJzY3JpcHRpb24uICBUaGlzIGlzIHRoZSBmdW5jdGlvbiB0aGF0XG4vLyBkb2VzIHRoYXQuXG5cbkN1cnNvci5wcm90b3R5cGUuX3B1Ymxpc2hDdXJzb3IgPSBmdW5jdGlvbiAoc3ViKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5jb2xsZWN0aW9uTmFtZTtcbiAgcmV0dXJuIE1vbmdvLkNvbGxlY3Rpb24uX3B1Ymxpc2hDdXJzb3Ioc2VsZiwgc3ViLCBjb2xsZWN0aW9uKTtcbn07XG5cbi8vIFVzZWQgdG8gZ3VhcmFudGVlIHRoYXQgcHVibGlzaCBmdW5jdGlvbnMgcmV0dXJuIGF0IG1vc3Qgb25lIGN1cnNvciBwZXJcbi8vIGNvbGxlY3Rpb24uIFByaXZhdGUsIGJlY2F1c2Ugd2UgbWlnaHQgbGF0ZXIgaGF2ZSBjdXJzb3JzIHRoYXQgaW5jbHVkZVxuLy8gZG9jdW1lbnRzIGZyb20gbXVsdGlwbGUgY29sbGVjdGlvbnMgc29tZWhvdy5cbkN1cnNvci5wcm90b3R5cGUuX2dldENvbGxlY3Rpb25OYW1lID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHJldHVybiBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5jb2xsZWN0aW9uTmFtZTtcbn07XG5cbkN1cnNvci5wcm90b3R5cGUub2JzZXJ2ZSA9IGZ1bmN0aW9uIChjYWxsYmFja3MpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICByZXR1cm4gTG9jYWxDb2xsZWN0aW9uLl9vYnNlcnZlRnJvbU9ic2VydmVDaGFuZ2VzKHNlbGYsIGNhbGxiYWNrcyk7XG59O1xuXG5DdXJzb3IucHJvdG90eXBlLm9ic2VydmVDaGFuZ2VzID0gZnVuY3Rpb24gKGNhbGxiYWNrcykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHZhciBtZXRob2RzID0gW1xuICAgICdhZGRlZEF0JyxcbiAgICAnYWRkZWQnLFxuICAgICdjaGFuZ2VkQXQnLFxuICAgICdjaGFuZ2VkJyxcbiAgICAncmVtb3ZlZEF0JyxcbiAgICAncmVtb3ZlZCcsXG4gICAgJ21vdmVkVG8nXG4gIF07XG4gIHZhciBvcmRlcmVkID0gTG9jYWxDb2xsZWN0aW9uLl9vYnNlcnZlQ2hhbmdlc0NhbGxiYWNrc0FyZU9yZGVyZWQoY2FsbGJhY2tzKTtcblxuICAvLyBYWFg6IENhbiB3ZSBmaW5kIG91dCBpZiBjYWxsYmFja3MgYXJlIGZyb20gb2JzZXJ2ZT9cbiAgdmFyIGV4Y2VwdGlvbk5hbWUgPSAnIG9ic2VydmUvb2JzZXJ2ZUNoYW5nZXMgY2FsbGJhY2snO1xuICBtZXRob2RzLmZvckVhY2goZnVuY3Rpb24gKG1ldGhvZCkge1xuICAgIGlmIChjYWxsYmFja3NbbWV0aG9kXSAmJiB0eXBlb2YgY2FsbGJhY2tzW21ldGhvZF0gPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBjYWxsYmFja3NbbWV0aG9kXSA9IE1ldGVvci5iaW5kRW52aXJvbm1lbnQoY2FsbGJhY2tzW21ldGhvZF0sIG1ldGhvZCArIGV4Y2VwdGlvbk5hbWUpO1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIHNlbGYuX21vbmdvLl9vYnNlcnZlQ2hhbmdlcyhcbiAgICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbiwgb3JkZXJlZCwgY2FsbGJhY2tzKTtcbn07XG5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX2NyZWF0ZVN5bmNocm9ub3VzQ3Vyc29yID0gZnVuY3Rpb24oXG4gICAgY3Vyc29yRGVzY3JpcHRpb24sIG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBvcHRpb25zID0gXy5waWNrKG9wdGlvbnMgfHwge30sICdzZWxmRm9ySXRlcmF0aW9uJywgJ3VzZVRyYW5zZm9ybScpO1xuXG4gIHZhciBjb2xsZWN0aW9uID0gc2VsZi5yYXdDb2xsZWN0aW9uKGN1cnNvckRlc2NyaXB0aW9uLmNvbGxlY3Rpb25OYW1lKTtcbiAgdmFyIGN1cnNvck9wdGlvbnMgPSBjdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zO1xuICB2YXIgbW9uZ29PcHRpb25zID0ge1xuICAgIHNvcnQ6IGN1cnNvck9wdGlvbnMuc29ydCxcbiAgICBsaW1pdDogY3Vyc29yT3B0aW9ucy5saW1pdCxcbiAgICBza2lwOiBjdXJzb3JPcHRpb25zLnNraXBcbiAgfTtcblxuICAvLyBEbyB3ZSB3YW50IGEgdGFpbGFibGUgY3Vyc29yICh3aGljaCBvbmx5IHdvcmtzIG9uIGNhcHBlZCBjb2xsZWN0aW9ucyk/XG4gIGlmIChjdXJzb3JPcHRpb25zLnRhaWxhYmxlKSB7XG4gICAgLy8gV2Ugd2FudCBhIHRhaWxhYmxlIGN1cnNvci4uLlxuICAgIG1vbmdvT3B0aW9ucy50YWlsYWJsZSA9IHRydWU7XG4gICAgLy8gLi4uIGFuZCBmb3IgdGhlIHNlcnZlciB0byB3YWl0IGEgYml0IGlmIGFueSBnZXRNb3JlIGhhcyBubyBkYXRhIChyYXRoZXJcbiAgICAvLyB0aGFuIG1ha2luZyB1cyBwdXQgdGhlIHJlbGV2YW50IHNsZWVwcyBpbiB0aGUgY2xpZW50KS4uLlxuICAgIG1vbmdvT3B0aW9ucy5hd2FpdGRhdGEgPSB0cnVlO1xuICAgIC8vIC4uLiBhbmQgdG8ga2VlcCBxdWVyeWluZyB0aGUgc2VydmVyIGluZGVmaW5pdGVseSByYXRoZXIgdGhhbiBqdXN0IDUgdGltZXNcbiAgICAvLyBpZiB0aGVyZSdzIG5vIG1vcmUgZGF0YS5cbiAgICBtb25nb09wdGlvbnMubnVtYmVyT2ZSZXRyaWVzID0gLTE7XG4gICAgLy8gQW5kIGlmIHRoaXMgaXMgb24gdGhlIG9wbG9nIGNvbGxlY3Rpb24gYW5kIHRoZSBjdXJzb3Igc3BlY2lmaWVzIGEgJ3RzJyxcbiAgICAvLyB0aGVuIHNldCB0aGUgdW5kb2N1bWVudGVkIG9wbG9nIHJlcGxheSBmbGFnLCB3aGljaCBkb2VzIGEgc3BlY2lhbCBzY2FuIHRvXG4gICAgLy8gZmluZCB0aGUgZmlyc3QgZG9jdW1lbnQgKGluc3RlYWQgb2YgY3JlYXRpbmcgYW4gaW5kZXggb24gdHMpLiBUaGlzIGlzIGFcbiAgICAvLyB2ZXJ5IGhhcmQtY29kZWQgTW9uZ28gZmxhZyB3aGljaCBvbmx5IHdvcmtzIG9uIHRoZSBvcGxvZyBjb2xsZWN0aW9uIGFuZFxuICAgIC8vIG9ubHkgd29ya3Mgd2l0aCB0aGUgdHMgZmllbGQuXG4gICAgaWYgKGN1cnNvckRlc2NyaXB0aW9uLmNvbGxlY3Rpb25OYW1lID09PSBPUExPR19DT0xMRUNUSU9OICYmXG4gICAgICAgIGN1cnNvckRlc2NyaXB0aW9uLnNlbGVjdG9yLnRzKSB7XG4gICAgICBtb25nb09wdGlvbnMub3Bsb2dSZXBsYXkgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHZhciBkYkN1cnNvciA9IGNvbGxlY3Rpb24uZmluZChcbiAgICByZXBsYWNlVHlwZXMoY3Vyc29yRGVzY3JpcHRpb24uc2VsZWN0b3IsIHJlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvKSxcbiAgICBjdXJzb3JPcHRpb25zLmZpZWxkcywgbW9uZ29PcHRpb25zKTtcblxuICBpZiAodHlwZW9mIGN1cnNvck9wdGlvbnMubWF4VGltZU1zICE9PSAndW5kZWZpbmVkJykge1xuICAgIGRiQ3Vyc29yID0gZGJDdXJzb3IubWF4VGltZU1TKGN1cnNvck9wdGlvbnMubWF4VGltZU1zKTtcbiAgfVxuICBpZiAodHlwZW9mIGN1cnNvck9wdGlvbnMuaGludCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBkYkN1cnNvciA9IGRiQ3Vyc29yLmhpbnQoY3Vyc29yT3B0aW9ucy5oaW50KTtcbiAgfVxuXG4gIHJldHVybiBuZXcgU3luY2hyb25vdXNDdXJzb3IoZGJDdXJzb3IsIGN1cnNvckRlc2NyaXB0aW9uLCBvcHRpb25zKTtcbn07XG5cbnZhciBTeW5jaHJvbm91c0N1cnNvciA9IGZ1bmN0aW9uIChkYkN1cnNvciwgY3Vyc29yRGVzY3JpcHRpb24sIG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBvcHRpb25zID0gXy5waWNrKG9wdGlvbnMgfHwge30sICdzZWxmRm9ySXRlcmF0aW9uJywgJ3VzZVRyYW5zZm9ybScpO1xuXG4gIHNlbGYuX2RiQ3Vyc29yID0gZGJDdXJzb3I7XG4gIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uID0gY3Vyc29yRGVzY3JpcHRpb247XG4gIC8vIFRoZSBcInNlbGZcIiBhcmd1bWVudCBwYXNzZWQgdG8gZm9yRWFjaC9tYXAgY2FsbGJhY2tzLiBJZiB3ZSdyZSB3cmFwcGVkXG4gIC8vIGluc2lkZSBhIHVzZXItdmlzaWJsZSBDdXJzb3IsIHdlIHdhbnQgdG8gcHJvdmlkZSB0aGUgb3V0ZXIgY3Vyc29yIVxuICBzZWxmLl9zZWxmRm9ySXRlcmF0aW9uID0gb3B0aW9ucy5zZWxmRm9ySXRlcmF0aW9uIHx8IHNlbGY7XG4gIGlmIChvcHRpb25zLnVzZVRyYW5zZm9ybSAmJiBjdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnRyYW5zZm9ybSkge1xuICAgIHNlbGYuX3RyYW5zZm9ybSA9IExvY2FsQ29sbGVjdGlvbi53cmFwVHJhbnNmb3JtKFxuICAgICAgY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy50cmFuc2Zvcm0pO1xuICB9IGVsc2Uge1xuICAgIHNlbGYuX3RyYW5zZm9ybSA9IG51bGw7XG4gIH1cblxuICAvLyBOZWVkIHRvIHNwZWNpZnkgdGhhdCB0aGUgY2FsbGJhY2sgaXMgdGhlIGZpcnN0IGFyZ3VtZW50IHRvIG5leHRPYmplY3QsXG4gIC8vIHNpbmNlIG90aGVyd2lzZSB3aGVuIHdlIHRyeSB0byBjYWxsIGl0IHdpdGggbm8gYXJncyB0aGUgZHJpdmVyIHdpbGxcbiAgLy8gaW50ZXJwcmV0IFwidW5kZWZpbmVkXCIgZmlyc3QgYXJnIGFzIGFuIG9wdGlvbnMgaGFzaCBhbmQgY3Jhc2guXG4gIHNlbGYuX3N5bmNocm9ub3VzTmV4dE9iamVjdCA9IEZ1dHVyZS53cmFwKFxuICAgIGRiQ3Vyc29yLm5leHRPYmplY3QuYmluZChkYkN1cnNvciksIDApO1xuICBzZWxmLl9zeW5jaHJvbm91c0NvdW50ID0gRnV0dXJlLndyYXAoZGJDdXJzb3IuY291bnQuYmluZChkYkN1cnNvcikpO1xuICBzZWxmLl92aXNpdGVkSWRzID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG59O1xuXG5fLmV4dGVuZChTeW5jaHJvbm91c0N1cnNvci5wcm90b3R5cGUsIHtcbiAgX25leHRPYmplY3Q6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdmFyIGRvYyA9IHNlbGYuX3N5bmNocm9ub3VzTmV4dE9iamVjdCgpLndhaXQoKTtcblxuICAgICAgaWYgKCFkb2MpIHJldHVybiBudWxsO1xuICAgICAgZG9jID0gcmVwbGFjZVR5cGVzKGRvYywgcmVwbGFjZU1vbmdvQXRvbVdpdGhNZXRlb3IpO1xuXG4gICAgICBpZiAoIXNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMudGFpbGFibGUgJiYgXy5oYXMoZG9jLCAnX2lkJykpIHtcbiAgICAgICAgLy8gRGlkIE1vbmdvIGdpdmUgdXMgZHVwbGljYXRlIGRvY3VtZW50cyBpbiB0aGUgc2FtZSBjdXJzb3I/IElmIHNvLFxuICAgICAgICAvLyBpZ25vcmUgdGhpcyBvbmUuIChEbyB0aGlzIGJlZm9yZSB0aGUgdHJhbnNmb3JtLCBzaW5jZSB0cmFuc2Zvcm0gbWlnaHRcbiAgICAgICAgLy8gcmV0dXJuIHNvbWUgdW5yZWxhdGVkIHZhbHVlLikgV2UgZG9uJ3QgZG8gdGhpcyBmb3IgdGFpbGFibGUgY3Vyc29ycyxcbiAgICAgICAgLy8gYmVjYXVzZSB3ZSB3YW50IHRvIG1haW50YWluIE8oMSkgbWVtb3J5IHVzYWdlLiBBbmQgaWYgdGhlcmUgaXNuJ3QgX2lkXG4gICAgICAgIC8vIGZvciBzb21lIHJlYXNvbiAobWF5YmUgaXQncyB0aGUgb3Bsb2cpLCB0aGVuIHdlIGRvbid0IGRvIHRoaXMgZWl0aGVyLlxuICAgICAgICAvLyAoQmUgY2FyZWZ1bCB0byBkbyB0aGlzIGZvciBmYWxzZXkgYnV0IGV4aXN0aW5nIF9pZCwgdGhvdWdoLilcbiAgICAgICAgaWYgKHNlbGYuX3Zpc2l0ZWRJZHMuaGFzKGRvYy5faWQpKSBjb250aW51ZTtcbiAgICAgICAgc2VsZi5fdmlzaXRlZElkcy5zZXQoZG9jLl9pZCwgdHJ1ZSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChzZWxmLl90cmFuc2Zvcm0pXG4gICAgICAgIGRvYyA9IHNlbGYuX3RyYW5zZm9ybShkb2MpO1xuXG4gICAgICByZXR1cm4gZG9jO1xuICAgIH1cbiAgfSxcblxuICBmb3JFYWNoOiBmdW5jdGlvbiAoY2FsbGJhY2ssIHRoaXNBcmcpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAvLyBHZXQgYmFjayB0byB0aGUgYmVnaW5uaW5nLlxuICAgIHNlbGYuX3Jld2luZCgpO1xuXG4gICAgLy8gV2UgaW1wbGVtZW50IHRoZSBsb29wIG91cnNlbGYgaW5zdGVhZCBvZiB1c2luZyBzZWxmLl9kYkN1cnNvci5lYWNoLFxuICAgIC8vIGJlY2F1c2UgXCJlYWNoXCIgd2lsbCBjYWxsIGl0cyBjYWxsYmFjayBvdXRzaWRlIG9mIGEgZmliZXIgd2hpY2ggbWFrZXMgaXRcbiAgICAvLyBtdWNoIG1vcmUgY29tcGxleCB0byBtYWtlIHRoaXMgZnVuY3Rpb24gc3luY2hyb25vdXMuXG4gICAgdmFyIGluZGV4ID0gMDtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdmFyIGRvYyA9IHNlbGYuX25leHRPYmplY3QoKTtcbiAgICAgIGlmICghZG9jKSByZXR1cm47XG4gICAgICBjYWxsYmFjay5jYWxsKHRoaXNBcmcsIGRvYywgaW5kZXgrKywgc2VsZi5fc2VsZkZvckl0ZXJhdGlvbik7XG4gICAgfVxuICB9LFxuXG4gIC8vIFhYWCBBbGxvdyBvdmVybGFwcGluZyBjYWxsYmFjayBleGVjdXRpb25zIGlmIGNhbGxiYWNrIHlpZWxkcy5cbiAgbWFwOiBmdW5jdGlvbiAoY2FsbGJhY2ssIHRoaXNBcmcpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHJlcyA9IFtdO1xuICAgIHNlbGYuZm9yRWFjaChmdW5jdGlvbiAoZG9jLCBpbmRleCkge1xuICAgICAgcmVzLnB1c2goY2FsbGJhY2suY2FsbCh0aGlzQXJnLCBkb2MsIGluZGV4LCBzZWxmLl9zZWxmRm9ySXRlcmF0aW9uKSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHJlcztcbiAgfSxcblxuICBfcmV3aW5kOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgLy8ga25vd24gdG8gYmUgc3luY2hyb25vdXNcbiAgICBzZWxmLl9kYkN1cnNvci5yZXdpbmQoKTtcblxuICAgIHNlbGYuX3Zpc2l0ZWRJZHMgPSBuZXcgTG9jYWxDb2xsZWN0aW9uLl9JZE1hcDtcbiAgfSxcblxuICAvLyBNb3N0bHkgdXNhYmxlIGZvciB0YWlsYWJsZSBjdXJzb3JzLlxuICBjbG9zZTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHNlbGYuX2RiQ3Vyc29yLmNsb3NlKCk7XG4gIH0sXG5cbiAgZmV0Y2g6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHNlbGYubWFwKF8uaWRlbnRpdHkpO1xuICB9LFxuXG4gIGNvdW50OiBmdW5jdGlvbiAoYXBwbHlTa2lwTGltaXQgPSBmYWxzZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gc2VsZi5fc3luY2hyb25vdXNDb3VudChhcHBseVNraXBMaW1pdCkud2FpdCgpO1xuICB9LFxuXG4gIC8vIFRoaXMgbWV0aG9kIGlzIE5PVCB3cmFwcGVkIGluIEN1cnNvci5cbiAgZ2V0UmF3T2JqZWN0czogZnVuY3Rpb24gKG9yZGVyZWQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKG9yZGVyZWQpIHtcbiAgICAgIHJldHVybiBzZWxmLmZldGNoKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciByZXN1bHRzID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gICAgICBzZWxmLmZvckVhY2goZnVuY3Rpb24gKGRvYykge1xuICAgICAgICByZXN1bHRzLnNldChkb2MuX2lkLCBkb2MpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9XG4gIH1cbn0pO1xuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLnRhaWwgPSBmdW5jdGlvbiAoY3Vyc29yRGVzY3JpcHRpb24sIGRvY0NhbGxiYWNrKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKCFjdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnRhaWxhYmxlKVxuICAgIHRocm93IG5ldyBFcnJvcihcIkNhbiBvbmx5IHRhaWwgYSB0YWlsYWJsZSBjdXJzb3JcIik7XG5cbiAgdmFyIGN1cnNvciA9IHNlbGYuX2NyZWF0ZVN5bmNocm9ub3VzQ3Vyc29yKGN1cnNvckRlc2NyaXB0aW9uKTtcblxuICB2YXIgc3RvcHBlZCA9IGZhbHNlO1xuICB2YXIgbGFzdFRTO1xuICB2YXIgbG9vcCA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgZG9jID0gbnVsbDtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgaWYgKHN0b3BwZWQpXG4gICAgICAgIHJldHVybjtcbiAgICAgIHRyeSB7XG4gICAgICAgIGRvYyA9IGN1cnNvci5fbmV4dE9iamVjdCgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIC8vIFRoZXJlJ3Mgbm8gZ29vZCB3YXkgdG8gZmlndXJlIG91dCBpZiB0aGlzIHdhcyBhY3R1YWxseSBhbiBlcnJvclxuICAgICAgICAvLyBmcm9tIE1vbmdvLiBBaCB3ZWxsLiBCdXQgZWl0aGVyIHdheSwgd2UgbmVlZCB0byByZXRyeSB0aGUgY3Vyc29yXG4gICAgICAgIC8vICh1bmxlc3MgdGhlIGZhaWx1cmUgd2FzIGJlY2F1c2UgdGhlIG9ic2VydmUgZ290IHN0b3BwZWQpLlxuICAgICAgICBkb2MgPSBudWxsO1xuICAgICAgfVxuICAgICAgLy8gU2luY2UgY3Vyc29yLl9uZXh0T2JqZWN0IGNhbiB5aWVsZCwgd2UgbmVlZCB0byBjaGVjayBhZ2FpbiB0byBzZWUgaWZcbiAgICAgIC8vIHdlJ3ZlIGJlZW4gc3RvcHBlZCBiZWZvcmUgY2FsbGluZyB0aGUgY2FsbGJhY2suXG4gICAgICBpZiAoc3RvcHBlZClcbiAgICAgICAgcmV0dXJuO1xuICAgICAgaWYgKGRvYykge1xuICAgICAgICAvLyBJZiBhIHRhaWxhYmxlIGN1cnNvciBjb250YWlucyBhIFwidHNcIiBmaWVsZCwgdXNlIGl0IHRvIHJlY3JlYXRlIHRoZVxuICAgICAgICAvLyBjdXJzb3Igb24gZXJyb3IuIChcInRzXCIgaXMgYSBzdGFuZGFyZCB0aGF0IE1vbmdvIHVzZXMgaW50ZXJuYWxseSBmb3JcbiAgICAgICAgLy8gdGhlIG9wbG9nLCBhbmQgdGhlcmUncyBhIHNwZWNpYWwgZmxhZyB0aGF0IGxldHMgeW91IGRvIGJpbmFyeSBzZWFyY2hcbiAgICAgICAgLy8gb24gaXQgaW5zdGVhZCBvZiBuZWVkaW5nIHRvIHVzZSBhbiBpbmRleC4pXG4gICAgICAgIGxhc3RUUyA9IGRvYy50cztcbiAgICAgICAgZG9jQ2FsbGJhY2soZG9jKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBuZXdTZWxlY3RvciA9IF8uY2xvbmUoY3Vyc29yRGVzY3JpcHRpb24uc2VsZWN0b3IpO1xuICAgICAgICBpZiAobGFzdFRTKSB7XG4gICAgICAgICAgbmV3U2VsZWN0b3IudHMgPSB7JGd0OiBsYXN0VFN9O1xuICAgICAgICB9XG4gICAgICAgIGN1cnNvciA9IHNlbGYuX2NyZWF0ZVN5bmNocm9ub3VzQ3Vyc29yKG5ldyBDdXJzb3JEZXNjcmlwdGlvbihcbiAgICAgICAgICBjdXJzb3JEZXNjcmlwdGlvbi5jb2xsZWN0aW9uTmFtZSxcbiAgICAgICAgICBuZXdTZWxlY3RvcixcbiAgICAgICAgICBjdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zKSk7XG4gICAgICAgIC8vIE1vbmdvIGZhaWxvdmVyIHRha2VzIG1hbnkgc2Vjb25kcy4gIFJldHJ5IGluIGEgYml0LiAgKFdpdGhvdXQgdGhpc1xuICAgICAgICAvLyBzZXRUaW1lb3V0LCB3ZSBwZWcgdGhlIENQVSBhdCAxMDAlIGFuZCBuZXZlciBub3RpY2UgdGhlIGFjdHVhbFxuICAgICAgICAvLyBmYWlsb3Zlci5cbiAgICAgICAgTWV0ZW9yLnNldFRpbWVvdXQobG9vcCwgMTAwKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIE1ldGVvci5kZWZlcihsb29wKTtcblxuICByZXR1cm4ge1xuICAgIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICAgIHN0b3BwZWQgPSB0cnVlO1xuICAgICAgY3Vyc29yLmNsb3NlKCk7XG4gICAgfVxuICB9O1xufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fb2JzZXJ2ZUNoYW5nZXMgPSBmdW5jdGlvbiAoXG4gICAgY3Vyc29yRGVzY3JpcHRpb24sIG9yZGVyZWQsIGNhbGxiYWNrcykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgaWYgKGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMudGFpbGFibGUpIHtcbiAgICByZXR1cm4gc2VsZi5fb2JzZXJ2ZUNoYW5nZXNUYWlsYWJsZShjdXJzb3JEZXNjcmlwdGlvbiwgb3JkZXJlZCwgY2FsbGJhY2tzKTtcbiAgfVxuXG4gIC8vIFlvdSBtYXkgbm90IGZpbHRlciBvdXQgX2lkIHdoZW4gb2JzZXJ2aW5nIGNoYW5nZXMsIGJlY2F1c2UgdGhlIGlkIGlzIGEgY29yZVxuICAvLyBwYXJ0IG9mIHRoZSBvYnNlcnZlQ2hhbmdlcyBBUEkuXG4gIGlmIChjdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLmZpZWxkcyAmJlxuICAgICAgKGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMuZmllbGRzLl9pZCA9PT0gMCB8fFxuICAgICAgIGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMuZmllbGRzLl9pZCA9PT0gZmFsc2UpKSB7XG4gICAgdGhyb3cgRXJyb3IoXCJZb3UgbWF5IG5vdCBvYnNlcnZlIGEgY3Vyc29yIHdpdGgge2ZpZWxkczoge19pZDogMH19XCIpO1xuICB9XG5cbiAgdmFyIG9ic2VydmVLZXkgPSBFSlNPTi5zdHJpbmdpZnkoXG4gICAgXy5leHRlbmQoe29yZGVyZWQ6IG9yZGVyZWR9LCBjdXJzb3JEZXNjcmlwdGlvbikpO1xuXG4gIHZhciBtdWx0aXBsZXhlciwgb2JzZXJ2ZURyaXZlcjtcbiAgdmFyIGZpcnN0SGFuZGxlID0gZmFsc2U7XG5cbiAgLy8gRmluZCBhIG1hdGNoaW5nIE9ic2VydmVNdWx0aXBsZXhlciwgb3IgY3JlYXRlIGEgbmV3IG9uZS4gVGhpcyBuZXh0IGJsb2NrIGlzXG4gIC8vIGd1YXJhbnRlZWQgdG8gbm90IHlpZWxkIChhbmQgaXQgZG9lc24ndCBjYWxsIGFueXRoaW5nIHRoYXQgY2FuIG9ic2VydmUgYVxuICAvLyBuZXcgcXVlcnkpLCBzbyBubyBvdGhlciBjYWxscyB0byB0aGlzIGZ1bmN0aW9uIGNhbiBpbnRlcmxlYXZlIHdpdGggaXQuXG4gIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoXy5oYXMoc2VsZi5fb2JzZXJ2ZU11bHRpcGxleGVycywgb2JzZXJ2ZUtleSkpIHtcbiAgICAgIG11bHRpcGxleGVyID0gc2VsZi5fb2JzZXJ2ZU11bHRpcGxleGVyc1tvYnNlcnZlS2V5XTtcbiAgICB9IGVsc2Uge1xuICAgICAgZmlyc3RIYW5kbGUgPSB0cnVlO1xuICAgICAgLy8gQ3JlYXRlIGEgbmV3IE9ic2VydmVNdWx0aXBsZXhlci5cbiAgICAgIG11bHRpcGxleGVyID0gbmV3IE9ic2VydmVNdWx0aXBsZXhlcih7XG4gICAgICAgIG9yZGVyZWQ6IG9yZGVyZWQsXG4gICAgICAgIG9uU3RvcDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgIGRlbGV0ZSBzZWxmLl9vYnNlcnZlTXVsdGlwbGV4ZXJzW29ic2VydmVLZXldO1xuICAgICAgICAgIG9ic2VydmVEcml2ZXIuc3RvcCgpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHNlbGYuX29ic2VydmVNdWx0aXBsZXhlcnNbb2JzZXJ2ZUtleV0gPSBtdWx0aXBsZXhlcjtcbiAgICB9XG4gIH0pO1xuXG4gIHZhciBvYnNlcnZlSGFuZGxlID0gbmV3IE9ic2VydmVIYW5kbGUobXVsdGlwbGV4ZXIsIGNhbGxiYWNrcyk7XG5cbiAgaWYgKGZpcnN0SGFuZGxlKSB7XG4gICAgdmFyIG1hdGNoZXIsIHNvcnRlcjtcbiAgICB2YXIgY2FuVXNlT3Bsb2cgPSBfLmFsbChbXG4gICAgICBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIEF0IGEgYmFyZSBtaW5pbXVtLCB1c2luZyB0aGUgb3Bsb2cgcmVxdWlyZXMgdXMgdG8gaGF2ZSBhbiBvcGxvZywgdG9cbiAgICAgICAgLy8gd2FudCB1bm9yZGVyZWQgY2FsbGJhY2tzLCBhbmQgdG8gbm90IHdhbnQgYSBjYWxsYmFjayBvbiB0aGUgcG9sbHNcbiAgICAgICAgLy8gdGhhdCB3b24ndCBoYXBwZW4uXG4gICAgICAgIHJldHVybiBzZWxmLl9vcGxvZ0hhbmRsZSAmJiAhb3JkZXJlZCAmJlxuICAgICAgICAgICFjYWxsYmFja3MuX3Rlc3RPbmx5UG9sbENhbGxiYWNrO1xuICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyBXZSBuZWVkIHRvIGJlIGFibGUgdG8gY29tcGlsZSB0aGUgc2VsZWN0b3IuIEZhbGwgYmFjayB0byBwb2xsaW5nIGZvclxuICAgICAgICAvLyBzb21lIG5ld2ZhbmdsZWQgJHNlbGVjdG9yIHRoYXQgbWluaW1vbmdvIGRvZXNuJ3Qgc3VwcG9ydCB5ZXQuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgbWF0Y2hlciA9IG5ldyBNaW5pbW9uZ28uTWF0Y2hlcihjdXJzb3JEZXNjcmlwdGlvbi5zZWxlY3Rvcik7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAvLyBYWFggbWFrZSBhbGwgY29tcGlsYXRpb24gZXJyb3JzIE1pbmltb25nb0Vycm9yIG9yIHNvbWV0aGluZ1xuICAgICAgICAgIC8vICAgICBzbyB0aGF0IHRoaXMgZG9lc24ndCBpZ25vcmUgdW5yZWxhdGVkIGV4Y2VwdGlvbnNcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLy8gLi4uIGFuZCB0aGUgc2VsZWN0b3IgaXRzZWxmIG5lZWRzIHRvIHN1cHBvcnQgb3Bsb2cuXG4gICAgICAgIHJldHVybiBPcGxvZ09ic2VydmVEcml2ZXIuY3Vyc29yU3VwcG9ydGVkKGN1cnNvckRlc2NyaXB0aW9uLCBtYXRjaGVyKTtcbiAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLy8gQW5kIHdlIG5lZWQgdG8gYmUgYWJsZSB0byBjb21waWxlIHRoZSBzb3J0LCBpZiBhbnkuICBlZywgY2FuJ3QgYmVcbiAgICAgICAgLy8geyRuYXR1cmFsOiAxfS5cbiAgICAgICAgaWYgKCFjdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnNvcnQpXG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgc29ydGVyID0gbmV3IE1pbmltb25nby5Tb3J0ZXIoY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy5zb3J0LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgbWF0Y2hlcjogbWF0Y2hlciB9KTtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIC8vIFhYWCBtYWtlIGFsbCBjb21waWxhdGlvbiBlcnJvcnMgTWluaW1vbmdvRXJyb3Igb3Igc29tZXRoaW5nXG4gICAgICAgICAgLy8gICAgIHNvIHRoYXQgdGhpcyBkb2Vzbid0IGlnbm9yZSB1bnJlbGF0ZWQgZXhjZXB0aW9uc1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfV0sIGZ1bmN0aW9uIChmKSB7IHJldHVybiBmKCk7IH0pOyAgLy8gaW52b2tlIGVhY2ggZnVuY3Rpb25cblxuICAgIHZhciBkcml2ZXJDbGFzcyA9IGNhblVzZU9wbG9nID8gT3Bsb2dPYnNlcnZlRHJpdmVyIDogUG9sbGluZ09ic2VydmVEcml2ZXI7XG4gICAgb2JzZXJ2ZURyaXZlciA9IG5ldyBkcml2ZXJDbGFzcyh7XG4gICAgICBjdXJzb3JEZXNjcmlwdGlvbjogY3Vyc29yRGVzY3JpcHRpb24sXG4gICAgICBtb25nb0hhbmRsZTogc2VsZixcbiAgICAgIG11bHRpcGxleGVyOiBtdWx0aXBsZXhlcixcbiAgICAgIG9yZGVyZWQ6IG9yZGVyZWQsXG4gICAgICBtYXRjaGVyOiBtYXRjaGVyLCAgLy8gaWdub3JlZCBieSBwb2xsaW5nXG4gICAgICBzb3J0ZXI6IHNvcnRlciwgIC8vIGlnbm9yZWQgYnkgcG9sbGluZ1xuICAgICAgX3Rlc3RPbmx5UG9sbENhbGxiYWNrOiBjYWxsYmFja3MuX3Rlc3RPbmx5UG9sbENhbGxiYWNrXG4gICAgfSk7XG5cbiAgICAvLyBUaGlzIGZpZWxkIGlzIG9ubHkgc2V0IGZvciB1c2UgaW4gdGVzdHMuXG4gICAgbXVsdGlwbGV4ZXIuX29ic2VydmVEcml2ZXIgPSBvYnNlcnZlRHJpdmVyO1xuICB9XG5cbiAgLy8gQmxvY2tzIHVudGlsIHRoZSBpbml0aWFsIGFkZHMgaGF2ZSBiZWVuIHNlbnQuXG4gIG11bHRpcGxleGVyLmFkZEhhbmRsZUFuZFNlbmRJbml0aWFsQWRkcyhvYnNlcnZlSGFuZGxlKTtcblxuICByZXR1cm4gb2JzZXJ2ZUhhbmRsZTtcbn07XG5cbi8vIExpc3RlbiBmb3IgdGhlIGludmFsaWRhdGlvbiBtZXNzYWdlcyB0aGF0IHdpbGwgdHJpZ2dlciB1cyB0byBwb2xsIHRoZVxuLy8gZGF0YWJhc2UgZm9yIGNoYW5nZXMuIElmIHRoaXMgc2VsZWN0b3Igc3BlY2lmaWVzIHNwZWNpZmljIElEcywgc3BlY2lmeSB0aGVtXG4vLyBoZXJlLCBzbyB0aGF0IHVwZGF0ZXMgdG8gZGlmZmVyZW50IHNwZWNpZmljIElEcyBkb24ndCBjYXVzZSB1cyB0byBwb2xsLlxuLy8gbGlzdGVuQ2FsbGJhY2sgaXMgdGhlIHNhbWUga2luZCBvZiAobm90aWZpY2F0aW9uLCBjb21wbGV0ZSkgY2FsbGJhY2sgcGFzc2VkXG4vLyB0byBJbnZhbGlkYXRpb25Dcm9zc2Jhci5saXN0ZW4uXG5cbmxpc3RlbkFsbCA9IGZ1bmN0aW9uIChjdXJzb3JEZXNjcmlwdGlvbiwgbGlzdGVuQ2FsbGJhY2spIHtcbiAgdmFyIGxpc3RlbmVycyA9IFtdO1xuICBmb3JFYWNoVHJpZ2dlcihjdXJzb3JEZXNjcmlwdGlvbiwgZnVuY3Rpb24gKHRyaWdnZXIpIHtcbiAgICBsaXN0ZW5lcnMucHVzaChERFBTZXJ2ZXIuX0ludmFsaWRhdGlvbkNyb3NzYmFyLmxpc3RlbihcbiAgICAgIHRyaWdnZXIsIGxpc3RlbkNhbGxiYWNrKSk7XG4gIH0pO1xuXG4gIHJldHVybiB7XG4gICAgc3RvcDogZnVuY3Rpb24gKCkge1xuICAgICAgXy5lYWNoKGxpc3RlbmVycywgZnVuY3Rpb24gKGxpc3RlbmVyKSB7XG4gICAgICAgIGxpc3RlbmVyLnN0b3AoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfTtcbn07XG5cbmZvckVhY2hUcmlnZ2VyID0gZnVuY3Rpb24gKGN1cnNvckRlc2NyaXB0aW9uLCB0cmlnZ2VyQ2FsbGJhY2spIHtcbiAgdmFyIGtleSA9IHtjb2xsZWN0aW9uOiBjdXJzb3JEZXNjcmlwdGlvbi5jb2xsZWN0aW9uTmFtZX07XG4gIHZhciBzcGVjaWZpY0lkcyA9IExvY2FsQ29sbGVjdGlvbi5faWRzTWF0Y2hlZEJ5U2VsZWN0b3IoXG4gICAgY3Vyc29yRGVzY3JpcHRpb24uc2VsZWN0b3IpO1xuICBpZiAoc3BlY2lmaWNJZHMpIHtcbiAgICBfLmVhY2goc3BlY2lmaWNJZHMsIGZ1bmN0aW9uIChpZCkge1xuICAgICAgdHJpZ2dlckNhbGxiYWNrKF8uZXh0ZW5kKHtpZDogaWR9LCBrZXkpKTtcbiAgICB9KTtcbiAgICB0cmlnZ2VyQ2FsbGJhY2soXy5leHRlbmQoe2Ryb3BDb2xsZWN0aW9uOiB0cnVlLCBpZDogbnVsbH0sIGtleSkpO1xuICB9IGVsc2Uge1xuICAgIHRyaWdnZXJDYWxsYmFjayhrZXkpO1xuICB9XG4gIC8vIEV2ZXJ5b25lIGNhcmVzIGFib3V0IHRoZSBkYXRhYmFzZSBiZWluZyBkcm9wcGVkLlxuICB0cmlnZ2VyQ2FsbGJhY2soeyBkcm9wRGF0YWJhc2U6IHRydWUgfSk7XG59O1xuXG4vLyBvYnNlcnZlQ2hhbmdlcyBmb3IgdGFpbGFibGUgY3Vyc29ycyBvbiBjYXBwZWQgY29sbGVjdGlvbnMuXG4vL1xuLy8gU29tZSBkaWZmZXJlbmNlcyBmcm9tIG5vcm1hbCBjdXJzb3JzOlxuLy8gICAtIFdpbGwgbmV2ZXIgcHJvZHVjZSBhbnl0aGluZyBvdGhlciB0aGFuICdhZGRlZCcgb3IgJ2FkZGVkQmVmb3JlJy4gSWYgeW91XG4vLyAgICAgZG8gdXBkYXRlIGEgZG9jdW1lbnQgdGhhdCBoYXMgYWxyZWFkeSBiZWVuIHByb2R1Y2VkLCB0aGlzIHdpbGwgbm90IG5vdGljZVxuLy8gICAgIGl0LlxuLy8gICAtIElmIHlvdSBkaXNjb25uZWN0IGFuZCByZWNvbm5lY3QgZnJvbSBNb25nbywgaXQgd2lsbCBlc3NlbnRpYWxseSByZXN0YXJ0XG4vLyAgICAgdGhlIHF1ZXJ5LCB3aGljaCB3aWxsIGxlYWQgdG8gZHVwbGljYXRlIHJlc3VsdHMuIFRoaXMgaXMgcHJldHR5IGJhZCxcbi8vICAgICBidXQgaWYgeW91IGluY2x1ZGUgYSBmaWVsZCBjYWxsZWQgJ3RzJyB3aGljaCBpcyBpbnNlcnRlZCBhc1xuLy8gICAgIG5ldyBNb25nb0ludGVybmFscy5Nb25nb1RpbWVzdGFtcCgwLCAwKSAod2hpY2ggaXMgaW5pdGlhbGl6ZWQgdG8gdGhlXG4vLyAgICAgY3VycmVudCBNb25nby1zdHlsZSB0aW1lc3RhbXApLCB3ZSdsbCBiZSBhYmxlIHRvIGZpbmQgdGhlIHBsYWNlIHRvXG4vLyAgICAgcmVzdGFydCBwcm9wZXJseS4gKFRoaXMgZmllbGQgaXMgc3BlY2lmaWNhbGx5IHVuZGVyc3Rvb2QgYnkgTW9uZ28gd2l0aCBhblxuLy8gICAgIG9wdGltaXphdGlvbiB3aGljaCBhbGxvd3MgaXQgdG8gZmluZCB0aGUgcmlnaHQgcGxhY2UgdG8gc3RhcnQgd2l0aG91dFxuLy8gICAgIGFuIGluZGV4IG9uIHRzLiBJdCdzIGhvdyB0aGUgb3Bsb2cgd29ya3MuKVxuLy8gICAtIE5vIGNhbGxiYWNrcyBhcmUgdHJpZ2dlcmVkIHN5bmNocm9ub3VzbHkgd2l0aCB0aGUgY2FsbCAodGhlcmUncyBub1xuLy8gICAgIGRpZmZlcmVudGlhdGlvbiBiZXR3ZWVuIFwiaW5pdGlhbCBkYXRhXCIgYW5kIFwibGF0ZXIgY2hhbmdlc1wiOyBldmVyeXRoaW5nXG4vLyAgICAgdGhhdCBtYXRjaGVzIHRoZSBxdWVyeSBnZXRzIHNlbnQgYXN5bmNocm9ub3VzbHkpLlxuLy8gICAtIERlLWR1cGxpY2F0aW9uIGlzIG5vdCBpbXBsZW1lbnRlZC5cbi8vICAgLSBEb2VzIG5vdCB5ZXQgaW50ZXJhY3Qgd2l0aCB0aGUgd3JpdGUgZmVuY2UuIFByb2JhYmx5LCB0aGlzIHNob3VsZCB3b3JrIGJ5XG4vLyAgICAgaWdub3JpbmcgcmVtb3ZlcyAod2hpY2ggZG9uJ3Qgd29yayBvbiBjYXBwZWQgY29sbGVjdGlvbnMpIGFuZCB1cGRhdGVzXG4vLyAgICAgKHdoaWNoIGRvbid0IGFmZmVjdCB0YWlsYWJsZSBjdXJzb3JzKSwgYW5kIGp1c3Qga2VlcGluZyB0cmFjayBvZiB0aGUgSURcbi8vICAgICBvZiB0aGUgaW5zZXJ0ZWQgb2JqZWN0LCBhbmQgY2xvc2luZyB0aGUgd3JpdGUgZmVuY2Ugb25jZSB5b3UgZ2V0IHRvIHRoYXRcbi8vICAgICBJRCAob3IgdGltZXN0YW1wPykuICBUaGlzIGRvZXNuJ3Qgd29yayB3ZWxsIGlmIHRoZSBkb2N1bWVudCBkb2Vzbid0IG1hdGNoXG4vLyAgICAgdGhlIHF1ZXJ5LCB0aG91Z2guICBPbiB0aGUgb3RoZXIgaGFuZCwgdGhlIHdyaXRlIGZlbmNlIGNhbiBjbG9zZVxuLy8gICAgIGltbWVkaWF0ZWx5IGlmIGl0IGRvZXMgbm90IG1hdGNoIHRoZSBxdWVyeS4gU28gaWYgd2UgdHJ1c3QgbWluaW1vbmdvXG4vLyAgICAgZW5vdWdoIHRvIGFjY3VyYXRlbHkgZXZhbHVhdGUgdGhlIHF1ZXJ5IGFnYWluc3QgdGhlIHdyaXRlIGZlbmNlLCB3ZVxuLy8gICAgIHNob3VsZCBiZSBhYmxlIHRvIGRvIHRoaXMuLi4gIE9mIGNvdXJzZSwgbWluaW1vbmdvIGRvZXNuJ3QgZXZlbiBzdXBwb3J0XG4vLyAgICAgTW9uZ28gVGltZXN0YW1wcyB5ZXQuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLl9vYnNlcnZlQ2hhbmdlc1RhaWxhYmxlID0gZnVuY3Rpb24gKFxuICAgIGN1cnNvckRlc2NyaXB0aW9uLCBvcmRlcmVkLCBjYWxsYmFja3MpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIC8vIFRhaWxhYmxlIGN1cnNvcnMgb25seSBldmVyIGNhbGwgYWRkZWQvYWRkZWRCZWZvcmUgY2FsbGJhY2tzLCBzbyBpdCdzIGFuXG4gIC8vIGVycm9yIGlmIHlvdSBkaWRuJ3QgcHJvdmlkZSB0aGVtLlxuICBpZiAoKG9yZGVyZWQgJiYgIWNhbGxiYWNrcy5hZGRlZEJlZm9yZSkgfHxcbiAgICAgICghb3JkZXJlZCAmJiAhY2FsbGJhY2tzLmFkZGVkKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkNhbid0IG9ic2VydmUgYW4gXCIgKyAob3JkZXJlZCA/IFwib3JkZXJlZFwiIDogXCJ1bm9yZGVyZWRcIilcbiAgICAgICAgICAgICAgICAgICAgKyBcIiB0YWlsYWJsZSBjdXJzb3Igd2l0aG91dCBhIFwiXG4gICAgICAgICAgICAgICAgICAgICsgKG9yZGVyZWQgPyBcImFkZGVkQmVmb3JlXCIgOiBcImFkZGVkXCIpICsgXCIgY2FsbGJhY2tcIik7XG4gIH1cblxuICByZXR1cm4gc2VsZi50YWlsKGN1cnNvckRlc2NyaXB0aW9uLCBmdW5jdGlvbiAoZG9jKSB7XG4gICAgdmFyIGlkID0gZG9jLl9pZDtcbiAgICBkZWxldGUgZG9jLl9pZDtcbiAgICAvLyBUaGUgdHMgaXMgYW4gaW1wbGVtZW50YXRpb24gZGV0YWlsLiBIaWRlIGl0LlxuICAgIGRlbGV0ZSBkb2MudHM7XG4gICAgaWYgKG9yZGVyZWQpIHtcbiAgICAgIGNhbGxiYWNrcy5hZGRlZEJlZm9yZShpZCwgZG9jLCBudWxsKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY2FsbGJhY2tzLmFkZGVkKGlkLCBkb2MpO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vLyBYWFggV2UgcHJvYmFibHkgbmVlZCB0byBmaW5kIGEgYmV0dGVyIHdheSB0byBleHBvc2UgdGhpcy4gUmlnaHQgbm93XG4vLyBpdCdzIG9ubHkgdXNlZCBieSB0ZXN0cywgYnV0IGluIGZhY3QgeW91IG5lZWQgaXQgaW4gbm9ybWFsXG4vLyBvcGVyYXRpb24gdG8gaW50ZXJhY3Qgd2l0aCBjYXBwZWQgY29sbGVjdGlvbnMuXG5Nb25nb0ludGVybmFscy5Nb25nb1RpbWVzdGFtcCA9IE1vbmdvREIuVGltZXN0YW1wO1xuXG5Nb25nb0ludGVybmFscy5Db25uZWN0aW9uID0gTW9uZ29Db25uZWN0aW9uO1xuIiwidmFyIEZ1dHVyZSA9IE5wbS5yZXF1aXJlKCdmaWJlcnMvZnV0dXJlJyk7XG5cbk9QTE9HX0NPTExFQ1RJT04gPSAnb3Bsb2cucnMnO1xuXG52YXIgVE9PX0ZBUl9CRUhJTkQgPSBwcm9jZXNzLmVudi5NRVRFT1JfT1BMT0dfVE9PX0ZBUl9CRUhJTkQgfHwgMjAwMDtcblxudmFyIHNob3dUUyA9IGZ1bmN0aW9uICh0cykge1xuICByZXR1cm4gXCJUaW1lc3RhbXAoXCIgKyB0cy5nZXRIaWdoQml0cygpICsgXCIsIFwiICsgdHMuZ2V0TG93Qml0cygpICsgXCIpXCI7XG59O1xuXG5pZEZvck9wID0gZnVuY3Rpb24gKG9wKSB7XG4gIGlmIChvcC5vcCA9PT0gJ2QnKVxuICAgIHJldHVybiBvcC5vLl9pZDtcbiAgZWxzZSBpZiAob3Aub3AgPT09ICdpJylcbiAgICByZXR1cm4gb3Auby5faWQ7XG4gIGVsc2UgaWYgKG9wLm9wID09PSAndScpXG4gICAgcmV0dXJuIG9wLm8yLl9pZDtcbiAgZWxzZSBpZiAob3Aub3AgPT09ICdjJylcbiAgICB0aHJvdyBFcnJvcihcIk9wZXJhdG9yICdjJyBkb2Vzbid0IHN1cHBseSBhbiBvYmplY3Qgd2l0aCBpZDogXCIgK1xuICAgICAgICAgICAgICAgIEVKU09OLnN0cmluZ2lmeShvcCkpO1xuICBlbHNlXG4gICAgdGhyb3cgRXJyb3IoXCJVbmtub3duIG9wOiBcIiArIEVKU09OLnN0cmluZ2lmeShvcCkpO1xufTtcblxuT3Bsb2dIYW5kbGUgPSBmdW5jdGlvbiAob3Bsb2dVcmwsIGRiTmFtZSkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHNlbGYuX29wbG9nVXJsID0gb3Bsb2dVcmw7XG4gIHNlbGYuX2RiTmFtZSA9IGRiTmFtZTtcblxuICBzZWxmLl9vcGxvZ0xhc3RFbnRyeUNvbm5lY3Rpb24gPSBudWxsO1xuICBzZWxmLl9vcGxvZ1RhaWxDb25uZWN0aW9uID0gbnVsbDtcbiAgc2VsZi5fc3RvcHBlZCA9IGZhbHNlO1xuICBzZWxmLl90YWlsSGFuZGxlID0gbnVsbDtcbiAgc2VsZi5fcmVhZHlGdXR1cmUgPSBuZXcgRnV0dXJlKCk7XG4gIHNlbGYuX2Nyb3NzYmFyID0gbmV3IEREUFNlcnZlci5fQ3Jvc3NiYXIoe1xuICAgIGZhY3RQYWNrYWdlOiBcIm1vbmdvLWxpdmVkYXRhXCIsIGZhY3ROYW1lOiBcIm9wbG9nLXdhdGNoZXJzXCJcbiAgfSk7XG4gIHNlbGYuX2Jhc2VPcGxvZ1NlbGVjdG9yID0ge1xuICAgIG5zOiBuZXcgUmVnRXhwKCdeJyArIE1ldGVvci5fZXNjYXBlUmVnRXhwKHNlbGYuX2RiTmFtZSkgKyAnXFxcXC4nKSxcbiAgICAkb3I6IFtcbiAgICAgIHsgb3A6IHskaW46IFsnaScsICd1JywgJ2QnXX0gfSxcbiAgICAgIC8vIGRyb3AgY29sbGVjdGlvblxuICAgICAgeyBvcDogJ2MnLCAnby5kcm9wJzogeyAkZXhpc3RzOiB0cnVlIH0gfSxcbiAgICAgIHsgb3A6ICdjJywgJ28uZHJvcERhdGFiYXNlJzogMSB9LFxuICAgIF1cbiAgfTtcblxuICAvLyBEYXRhIHN0cnVjdHVyZXMgdG8gc3VwcG9ydCB3YWl0VW50aWxDYXVnaHRVcCgpLiBFYWNoIG9wbG9nIGVudHJ5IGhhcyBhXG4gIC8vIE1vbmdvVGltZXN0YW1wIG9iamVjdCBvbiBpdCAod2hpY2ggaXMgbm90IHRoZSBzYW1lIGFzIGEgRGF0ZSAtLS0gaXQncyBhXG4gIC8vIGNvbWJpbmF0aW9uIG9mIHRpbWUgYW5kIGFuIGluY3JlbWVudGluZyBjb3VudGVyOyBzZWVcbiAgLy8gaHR0cDovL2RvY3MubW9uZ29kYi5vcmcvbWFudWFsL3JlZmVyZW5jZS9ic29uLXR5cGVzLyN0aW1lc3RhbXBzKS5cbiAgLy9cbiAgLy8gX2NhdGNoaW5nVXBGdXR1cmVzIGlzIGFuIGFycmF5IG9mIHt0czogTW9uZ29UaW1lc3RhbXAsIGZ1dHVyZTogRnV0dXJlfVxuICAvLyBvYmplY3RzLCBzb3J0ZWQgYnkgYXNjZW5kaW5nIHRpbWVzdGFtcC4gX2xhc3RQcm9jZXNzZWRUUyBpcyB0aGVcbiAgLy8gTW9uZ29UaW1lc3RhbXAgb2YgdGhlIGxhc3Qgb3Bsb2cgZW50cnkgd2UndmUgcHJvY2Vzc2VkLlxuICAvL1xuICAvLyBFYWNoIHRpbWUgd2UgY2FsbCB3YWl0VW50aWxDYXVnaHRVcCwgd2UgdGFrZSBhIHBlZWsgYXQgdGhlIGZpbmFsIG9wbG9nXG4gIC8vIGVudHJ5IGluIHRoZSBkYi4gIElmIHdlJ3ZlIGFscmVhZHkgcHJvY2Vzc2VkIGl0IChpZSwgaXQgaXMgbm90IGdyZWF0ZXIgdGhhblxuICAvLyBfbGFzdFByb2Nlc3NlZFRTKSwgd2FpdFVudGlsQ2F1Z2h0VXAgaW1tZWRpYXRlbHkgcmV0dXJucy4gT3RoZXJ3aXNlLFxuICAvLyB3YWl0VW50aWxDYXVnaHRVcCBtYWtlcyBhIG5ldyBGdXR1cmUgYW5kIGluc2VydHMgaXQgYWxvbmcgd2l0aCB0aGUgZmluYWxcbiAgLy8gdGltZXN0YW1wIGVudHJ5IHRoYXQgaXQgcmVhZCwgaW50byBfY2F0Y2hpbmdVcEZ1dHVyZXMuIHdhaXRVbnRpbENhdWdodFVwXG4gIC8vIHRoZW4gd2FpdHMgb24gdGhhdCBmdXR1cmUsIHdoaWNoIGlzIHJlc29sdmVkIG9uY2UgX2xhc3RQcm9jZXNzZWRUUyBpc1xuICAvLyBpbmNyZW1lbnRlZCB0byBiZSBwYXN0IGl0cyB0aW1lc3RhbXAgYnkgdGhlIHdvcmtlciBmaWJlci5cbiAgLy9cbiAgLy8gWFhYIHVzZSBhIHByaW9yaXR5IHF1ZXVlIG9yIHNvbWV0aGluZyBlbHNlIHRoYXQncyBmYXN0ZXIgdGhhbiBhbiBhcnJheVxuICBzZWxmLl9jYXRjaGluZ1VwRnV0dXJlcyA9IFtdO1xuICBzZWxmLl9sYXN0UHJvY2Vzc2VkVFMgPSBudWxsO1xuXG4gIHNlbGYuX29uU2tpcHBlZEVudHJpZXNIb29rID0gbmV3IEhvb2soe1xuICAgIGRlYnVnUHJpbnRFeGNlcHRpb25zOiBcIm9uU2tpcHBlZEVudHJpZXMgY2FsbGJhY2tcIlxuICB9KTtcblxuICBzZWxmLl9lbnRyeVF1ZXVlID0gbmV3IE1ldGVvci5fRG91YmxlRW5kZWRRdWV1ZSgpO1xuICBzZWxmLl93b3JrZXJBY3RpdmUgPSBmYWxzZTtcblxuICBzZWxmLl9zdGFydFRhaWxpbmcoKTtcbn07XG5cbl8uZXh0ZW5kKE9wbG9nSGFuZGxlLnByb3RvdHlwZSwge1xuICBzdG9wOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgICAgcmV0dXJuO1xuICAgIHNlbGYuX3N0b3BwZWQgPSB0cnVlO1xuICAgIGlmIChzZWxmLl90YWlsSGFuZGxlKVxuICAgICAgc2VsZi5fdGFpbEhhbmRsZS5zdG9wKCk7XG4gICAgLy8gWFhYIHNob3VsZCBjbG9zZSBjb25uZWN0aW9ucyB0b29cbiAgfSxcbiAgb25PcGxvZ0VudHJ5OiBmdW5jdGlvbiAodHJpZ2dlciwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYWxsZWQgb25PcGxvZ0VudHJ5IG9uIHN0b3BwZWQgaGFuZGxlIVwiKTtcblxuICAgIC8vIENhbGxpbmcgb25PcGxvZ0VudHJ5IHJlcXVpcmVzIHVzIHRvIHdhaXQgZm9yIHRoZSB0YWlsaW5nIHRvIGJlIHJlYWR5LlxuICAgIHNlbGYuX3JlYWR5RnV0dXJlLndhaXQoKTtcblxuICAgIHZhciBvcmlnaW5hbENhbGxiYWNrID0gY2FsbGJhY2s7XG4gICAgY2FsbGJhY2sgPSBNZXRlb3IuYmluZEVudmlyb25tZW50KGZ1bmN0aW9uIChub3RpZmljYXRpb24pIHtcbiAgICAgIC8vIFhYWCBjYW4gd2UgYXZvaWQgdGhpcyBjbG9uZSBieSBtYWtpbmcgb3Bsb2cuanMgY2FyZWZ1bD9cbiAgICAgIG9yaWdpbmFsQ2FsbGJhY2soRUpTT04uY2xvbmUobm90aWZpY2F0aW9uKSk7XG4gICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgTWV0ZW9yLl9kZWJ1ZyhcIkVycm9yIGluIG9wbG9nIGNhbGxiYWNrXCIsIGVyci5zdGFjayk7XG4gICAgfSk7XG4gICAgdmFyIGxpc3RlbkhhbmRsZSA9IHNlbGYuX2Nyb3NzYmFyLmxpc3Rlbih0cmlnZ2VyLCBjYWxsYmFjayk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgbGlzdGVuSGFuZGxlLnN0b3AoKTtcbiAgICAgIH1cbiAgICB9O1xuICB9LFxuICAvLyBSZWdpc3RlciBhIGNhbGxiYWNrIHRvIGJlIGludm9rZWQgYW55IHRpbWUgd2Ugc2tpcCBvcGxvZyBlbnRyaWVzIChlZyxcbiAgLy8gYmVjYXVzZSB3ZSBhcmUgdG9vIGZhciBiZWhpbmQpLlxuICBvblNraXBwZWRFbnRyaWVzOiBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYWxsZWQgb25Ta2lwcGVkRW50cmllcyBvbiBzdG9wcGVkIGhhbmRsZSFcIik7XG4gICAgcmV0dXJuIHNlbGYuX29uU2tpcHBlZEVudHJpZXNIb29rLnJlZ2lzdGVyKGNhbGxiYWNrKTtcbiAgfSxcbiAgLy8gQ2FsbHMgYGNhbGxiYWNrYCBvbmNlIHRoZSBvcGxvZyBoYXMgYmVlbiBwcm9jZXNzZWQgdXAgdG8gYSBwb2ludCB0aGF0IGlzXG4gIC8vIHJvdWdobHkgXCJub3dcIjogc3BlY2lmaWNhbGx5LCBvbmNlIHdlJ3ZlIHByb2Nlc3NlZCBhbGwgb3BzIHRoYXQgYXJlXG4gIC8vIGN1cnJlbnRseSB2aXNpYmxlLlxuICAvLyBYWFggYmVjb21lIGNvbnZpbmNlZCB0aGF0IHRoaXMgaXMgYWN0dWFsbHkgc2FmZSBldmVuIGlmIG9wbG9nQ29ubmVjdGlvblxuICAvLyBpcyBzb21lIGtpbmQgb2YgcG9vbFxuICB3YWl0VW50aWxDYXVnaHRVcDogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbGxlZCB3YWl0VW50aWxDYXVnaHRVcCBvbiBzdG9wcGVkIGhhbmRsZSFcIik7XG5cbiAgICAvLyBDYWxsaW5nIHdhaXRVbnRpbENhdWdodFVwIHJlcXVyaWVzIHVzIHRvIHdhaXQgZm9yIHRoZSBvcGxvZyBjb25uZWN0aW9uIHRvXG4gICAgLy8gYmUgcmVhZHkuXG4gICAgc2VsZi5fcmVhZHlGdXR1cmUud2FpdCgpO1xuICAgIHZhciBsYXN0RW50cnk7XG5cbiAgICB3aGlsZSAoIXNlbGYuX3N0b3BwZWQpIHtcbiAgICAgIC8vIFdlIG5lZWQgdG8gbWFrZSB0aGUgc2VsZWN0b3IgYXQgbGVhc3QgYXMgcmVzdHJpY3RpdmUgYXMgdGhlIGFjdHVhbFxuICAgICAgLy8gdGFpbGluZyBzZWxlY3RvciAoaWUsIHdlIG5lZWQgdG8gc3BlY2lmeSB0aGUgREIgbmFtZSkgb3IgZWxzZSB3ZSBtaWdodFxuICAgICAgLy8gZmluZCBhIFRTIHRoYXQgd29uJ3Qgc2hvdyB1cCBpbiB0aGUgYWN0dWFsIHRhaWwgc3RyZWFtLlxuICAgICAgdHJ5IHtcbiAgICAgICAgbGFzdEVudHJ5ID0gc2VsZi5fb3Bsb2dMYXN0RW50cnlDb25uZWN0aW9uLmZpbmRPbmUoXG4gICAgICAgICAgT1BMT0dfQ09MTEVDVElPTiwgc2VsZi5fYmFzZU9wbG9nU2VsZWN0b3IsXG4gICAgICAgICAge2ZpZWxkczoge3RzOiAxfSwgc29ydDogeyRuYXR1cmFsOiAtMX19KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIC8vIER1cmluZyBmYWlsb3ZlciAoZWcpIGlmIHdlIGdldCBhbiBleGNlcHRpb24gd2Ugc2hvdWxkIGxvZyBhbmQgcmV0cnlcbiAgICAgICAgLy8gaW5zdGVhZCBvZiBjcmFzaGluZy5cbiAgICAgICAgTWV0ZW9yLl9kZWJ1ZyhcIkdvdCBleGNlcHRpb24gd2hpbGUgcmVhZGluZyBsYXN0IGVudHJ5OiBcIiArIGUpO1xuICAgICAgICBNZXRlb3IuX3NsZWVwRm9yTXMoMTAwKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgIHJldHVybjtcblxuICAgIGlmICghbGFzdEVudHJ5KSB7XG4gICAgICAvLyBSZWFsbHksIG5vdGhpbmcgaW4gdGhlIG9wbG9nPyBXZWxsLCB3ZSd2ZSBwcm9jZXNzZWQgZXZlcnl0aGluZy5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgdHMgPSBsYXN0RW50cnkudHM7XG4gICAgaWYgKCF0cylcbiAgICAgIHRocm93IEVycm9yKFwib3Bsb2cgZW50cnkgd2l0aG91dCB0czogXCIgKyBFSlNPTi5zdHJpbmdpZnkobGFzdEVudHJ5KSk7XG5cbiAgICBpZiAoc2VsZi5fbGFzdFByb2Nlc3NlZFRTICYmIHRzLmxlc3NUaGFuT3JFcXVhbChzZWxmLl9sYXN0UHJvY2Vzc2VkVFMpKSB7XG4gICAgICAvLyBXZSd2ZSBhbHJlYWR5IGNhdWdodCB1cCB0byBoZXJlLlxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuXG4gICAgLy8gSW5zZXJ0IHRoZSBmdXR1cmUgaW50byBvdXIgbGlzdC4gQWxtb3N0IGFsd2F5cywgdGhpcyB3aWxsIGJlIGF0IHRoZSBlbmQsXG4gICAgLy8gYnV0IGl0J3MgY29uY2VpdmFibGUgdGhhdCBpZiB3ZSBmYWlsIG92ZXIgZnJvbSBvbmUgcHJpbWFyeSB0byBhbm90aGVyLFxuICAgIC8vIHRoZSBvcGxvZyBlbnRyaWVzIHdlIHNlZSB3aWxsIGdvIGJhY2t3YXJkcy5cbiAgICB2YXIgaW5zZXJ0QWZ0ZXIgPSBzZWxmLl9jYXRjaGluZ1VwRnV0dXJlcy5sZW5ndGg7XG4gICAgd2hpbGUgKGluc2VydEFmdGVyIC0gMSA+IDAgJiYgc2VsZi5fY2F0Y2hpbmdVcEZ1dHVyZXNbaW5zZXJ0QWZ0ZXIgLSAxXS50cy5ncmVhdGVyVGhhbih0cykpIHtcbiAgICAgIGluc2VydEFmdGVyLS07XG4gICAgfVxuICAgIHZhciBmID0gbmV3IEZ1dHVyZTtcbiAgICBzZWxmLl9jYXRjaGluZ1VwRnV0dXJlcy5zcGxpY2UoaW5zZXJ0QWZ0ZXIsIDAsIHt0czogdHMsIGZ1dHVyZTogZn0pO1xuICAgIGYud2FpdCgpO1xuICB9LFxuICBfc3RhcnRUYWlsaW5nOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIC8vIEZpcnN0LCBtYWtlIHN1cmUgdGhhdCB3ZSdyZSB0YWxraW5nIHRvIHRoZSBsb2NhbCBkYXRhYmFzZS5cbiAgICB2YXIgbW9uZ29kYlVyaSA9IE5wbS5yZXF1aXJlKCdtb25nb2RiLXVyaScpO1xuICAgIGlmIChtb25nb2RiVXJpLnBhcnNlKHNlbGYuX29wbG9nVXJsKS5kYXRhYmFzZSAhPT0gJ2xvY2FsJykge1xuICAgICAgdGhyb3cgRXJyb3IoXCIkTU9OR09fT1BMT0dfVVJMIG11c3QgYmUgc2V0IHRvIHRoZSAnbG9jYWwnIGRhdGFiYXNlIG9mIFwiICtcbiAgICAgICAgICAgICAgICAgIFwiYSBNb25nbyByZXBsaWNhIHNldFwiKTtcbiAgICB9XG5cbiAgICAvLyBXZSBtYWtlIHR3byBzZXBhcmF0ZSBjb25uZWN0aW9ucyB0byBNb25nby4gVGhlIE5vZGUgTW9uZ28gZHJpdmVyXG4gICAgLy8gaW1wbGVtZW50cyBhIG5haXZlIHJvdW5kLXJvYmluIGNvbm5lY3Rpb24gcG9vbDogZWFjaCBcImNvbm5lY3Rpb25cIiBpcyBhXG4gICAgLy8gcG9vbCBvZiBzZXZlcmFsICg1IGJ5IGRlZmF1bHQpIFRDUCBjb25uZWN0aW9ucywgYW5kIGVhY2ggcmVxdWVzdCBpc1xuICAgIC8vIHJvdGF0ZWQgdGhyb3VnaCB0aGUgcG9vbHMuIFRhaWxhYmxlIGN1cnNvciBxdWVyaWVzIGJsb2NrIG9uIHRoZSBzZXJ2ZXJcbiAgICAvLyB1bnRpbCB0aGVyZSBpcyBzb21lIGRhdGEgdG8gcmV0dXJuIChvciB1bnRpbCBhIGZldyBzZWNvbmRzIGhhdmVcbiAgICAvLyBwYXNzZWQpLiBTbyBpZiB0aGUgY29ubmVjdGlvbiBwb29sIHVzZWQgZm9yIHRhaWxpbmcgY3Vyc29ycyBpcyB0aGUgc2FtZVxuICAgIC8vIHBvb2wgdXNlZCBmb3Igb3RoZXIgcXVlcmllcywgdGhlIG90aGVyIHF1ZXJpZXMgd2lsbCBiZSBkZWxheWVkIGJ5IHNlY29uZHNcbiAgICAvLyAxLzUgb2YgdGhlIHRpbWUuXG4gICAgLy9cbiAgICAvLyBUaGUgdGFpbCBjb25uZWN0aW9uIHdpbGwgb25seSBldmVyIGJlIHJ1bm5pbmcgYSBzaW5nbGUgdGFpbCBjb21tYW5kLCBzb1xuICAgIC8vIGl0IG9ubHkgbmVlZHMgdG8gbWFrZSBvbmUgdW5kZXJseWluZyBUQ1AgY29ubmVjdGlvbi5cbiAgICBzZWxmLl9vcGxvZ1RhaWxDb25uZWN0aW9uID0gbmV3IE1vbmdvQ29ubmVjdGlvbihcbiAgICAgIHNlbGYuX29wbG9nVXJsLCB7cG9vbFNpemU6IDF9KTtcbiAgICAvLyBYWFggYmV0dGVyIGRvY3MsIGJ1dDogaXQncyB0byBnZXQgbW9ub3RvbmljIHJlc3VsdHNcbiAgICAvLyBYWFggaXMgaXQgc2FmZSB0byBzYXkgXCJpZiB0aGVyZSdzIGFuIGluIGZsaWdodCBxdWVyeSwganVzdCB1c2UgaXRzXG4gICAgLy8gICAgIHJlc3VsdHNcIj8gSSBkb24ndCB0aGluayBzbyBidXQgc2hvdWxkIGNvbnNpZGVyIHRoYXRcbiAgICBzZWxmLl9vcGxvZ0xhc3RFbnRyeUNvbm5lY3Rpb24gPSBuZXcgTW9uZ29Db25uZWN0aW9uKFxuICAgICAgc2VsZi5fb3Bsb2dVcmwsIHtwb29sU2l6ZTogMX0pO1xuXG4gICAgLy8gTm93LCBtYWtlIHN1cmUgdGhhdCB0aGVyZSBhY3R1YWxseSBpcyBhIHJlcGwgc2V0IGhlcmUuIElmIG5vdCwgb3Bsb2dcbiAgICAvLyB0YWlsaW5nIHdvbid0IGV2ZXIgZmluZCBhbnl0aGluZyFcbiAgICAvLyBNb3JlIG9uIHRoZSBpc01hc3RlckRvY1xuICAgIC8vIGh0dHBzOi8vZG9jcy5tb25nb2RiLmNvbS9tYW51YWwvcmVmZXJlbmNlL2NvbW1hbmQvaXNNYXN0ZXIvXG4gICAgdmFyIGYgPSBuZXcgRnV0dXJlO1xuICAgIHNlbGYuX29wbG9nTGFzdEVudHJ5Q29ubmVjdGlvbi5kYi5hZG1pbigpLmNvbW1hbmQoXG4gICAgICB7IGlzbWFzdGVyOiAxIH0sIGYucmVzb2x2ZXIoKSk7XG4gICAgdmFyIGlzTWFzdGVyRG9jID0gZi53YWl0KCk7XG5cbiAgICBpZiAoIShpc01hc3RlckRvYyAmJiBpc01hc3RlckRvYy5zZXROYW1lKSkge1xuICAgICAgdGhyb3cgRXJyb3IoXCIkTU9OR09fT1BMT0dfVVJMIG11c3QgYmUgc2V0IHRvIHRoZSAnbG9jYWwnIGRhdGFiYXNlIG9mIFwiICtcbiAgICAgICAgICAgICAgICAgIFwiYSBNb25nbyByZXBsaWNhIHNldFwiKTtcbiAgICB9XG5cbiAgICAvLyBGaW5kIHRoZSBsYXN0IG9wbG9nIGVudHJ5LlxuICAgIHZhciBsYXN0T3Bsb2dFbnRyeSA9IHNlbGYuX29wbG9nTGFzdEVudHJ5Q29ubmVjdGlvbi5maW5kT25lKFxuICAgICAgT1BMT0dfQ09MTEVDVElPTiwge30sIHtzb3J0OiB7JG5hdHVyYWw6IC0xfSwgZmllbGRzOiB7dHM6IDF9fSk7XG5cbiAgICB2YXIgb3Bsb2dTZWxlY3RvciA9IF8uY2xvbmUoc2VsZi5fYmFzZU9wbG9nU2VsZWN0b3IpO1xuICAgIGlmIChsYXN0T3Bsb2dFbnRyeSkge1xuICAgICAgLy8gU3RhcnQgYWZ0ZXIgdGhlIGxhc3QgZW50cnkgdGhhdCBjdXJyZW50bHkgZXhpc3RzLlxuICAgICAgb3Bsb2dTZWxlY3Rvci50cyA9IHskZ3Q6IGxhc3RPcGxvZ0VudHJ5LnRzfTtcbiAgICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgY2FsbHMgdG8gY2FsbFdoZW5Qcm9jZXNzZWRMYXRlc3QgYmVmb3JlIGFueSBvdGhlclxuICAgICAgLy8gb3Bsb2cgZW50cmllcyBzaG93IHVwLCBhbGxvdyBjYWxsV2hlblByb2Nlc3NlZExhdGVzdCB0byBjYWxsIGl0c1xuICAgICAgLy8gY2FsbGJhY2sgaW1tZWRpYXRlbHkuXG4gICAgICBzZWxmLl9sYXN0UHJvY2Vzc2VkVFMgPSBsYXN0T3Bsb2dFbnRyeS50cztcbiAgICB9XG5cbiAgICB2YXIgY3Vyc29yRGVzY3JpcHRpb24gPSBuZXcgQ3Vyc29yRGVzY3JpcHRpb24oXG4gICAgICBPUExPR19DT0xMRUNUSU9OLCBvcGxvZ1NlbGVjdG9yLCB7dGFpbGFibGU6IHRydWV9KTtcblxuICAgIHNlbGYuX3RhaWxIYW5kbGUgPSBzZWxmLl9vcGxvZ1RhaWxDb25uZWN0aW9uLnRhaWwoXG4gICAgICBjdXJzb3JEZXNjcmlwdGlvbiwgZnVuY3Rpb24gKGRvYykge1xuICAgICAgICBzZWxmLl9lbnRyeVF1ZXVlLnB1c2goZG9jKTtcbiAgICAgICAgc2VsZi5fbWF5YmVTdGFydFdvcmtlcigpO1xuICAgICAgfVxuICAgICk7XG4gICAgc2VsZi5fcmVhZHlGdXR1cmUucmV0dXJuKCk7XG4gIH0sXG5cbiAgX21heWJlU3RhcnRXb3JrZXI6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3dvcmtlckFjdGl2ZSlcbiAgICAgIHJldHVybjtcbiAgICBzZWxmLl93b3JrZXJBY3RpdmUgPSB0cnVlO1xuICAgIE1ldGVvci5kZWZlcihmdW5jdGlvbiAoKSB7XG4gICAgICB0cnkge1xuICAgICAgICB3aGlsZSAoISBzZWxmLl9zdG9wcGVkICYmICEgc2VsZi5fZW50cnlRdWV1ZS5pc0VtcHR5KCkpIHtcbiAgICAgICAgICAvLyBBcmUgd2UgdG9vIGZhciBiZWhpbmQ/IEp1c3QgdGVsbCBvdXIgb2JzZXJ2ZXJzIHRoYXQgdGhleSBuZWVkIHRvXG4gICAgICAgICAgLy8gcmVwb2xsLCBhbmQgZHJvcCBvdXIgcXVldWUuXG4gICAgICAgICAgaWYgKHNlbGYuX2VudHJ5UXVldWUubGVuZ3RoID4gVE9PX0ZBUl9CRUhJTkQpIHtcbiAgICAgICAgICAgIHZhciBsYXN0RW50cnkgPSBzZWxmLl9lbnRyeVF1ZXVlLnBvcCgpO1xuICAgICAgICAgICAgc2VsZi5fZW50cnlRdWV1ZS5jbGVhcigpO1xuXG4gICAgICAgICAgICBzZWxmLl9vblNraXBwZWRFbnRyaWVzSG9vay5lYWNoKGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBGcmVlIGFueSB3YWl0VW50aWxDYXVnaHRVcCgpIGNhbGxzIHRoYXQgd2VyZSB3YWl0aW5nIGZvciB1cyB0b1xuICAgICAgICAgICAgLy8gcGFzcyBzb21ldGhpbmcgdGhhdCB3ZSBqdXN0IHNraXBwZWQuXG4gICAgICAgICAgICBzZWxmLl9zZXRMYXN0UHJvY2Vzc2VkVFMobGFzdEVudHJ5LnRzKTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHZhciBkb2MgPSBzZWxmLl9lbnRyeVF1ZXVlLnNoaWZ0KCk7XG5cbiAgICAgICAgICBpZiAoIShkb2MubnMgJiYgZG9jLm5zLmxlbmd0aCA+IHNlbGYuX2RiTmFtZS5sZW5ndGggKyAxICYmXG4gICAgICAgICAgICAgICAgZG9jLm5zLnN1YnN0cigwLCBzZWxmLl9kYk5hbWUubGVuZ3RoICsgMSkgPT09XG4gICAgICAgICAgICAgICAgKHNlbGYuX2RiTmFtZSArICcuJykpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmV4cGVjdGVkIG5zXCIpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHZhciB0cmlnZ2VyID0ge2NvbGxlY3Rpb246IGRvYy5ucy5zdWJzdHIoc2VsZi5fZGJOYW1lLmxlbmd0aCArIDEpLFxuICAgICAgICAgICAgICAgICAgICAgICAgIGRyb3BDb2xsZWN0aW9uOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICBkcm9wRGF0YWJhc2U6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgIG9wOiBkb2N9O1xuXG4gICAgICAgICAgLy8gSXMgaXQgYSBzcGVjaWFsIGNvbW1hbmQgYW5kIHRoZSBjb2xsZWN0aW9uIG5hbWUgaXMgaGlkZGVuIHNvbWV3aGVyZVxuICAgICAgICAgIC8vIGluIG9wZXJhdG9yP1xuICAgICAgICAgIGlmICh0cmlnZ2VyLmNvbGxlY3Rpb24gPT09IFwiJGNtZFwiKSB7XG4gICAgICAgICAgICBpZiAoZG9jLm8uZHJvcERhdGFiYXNlKSB7XG4gICAgICAgICAgICAgIGRlbGV0ZSB0cmlnZ2VyLmNvbGxlY3Rpb247XG4gICAgICAgICAgICAgIHRyaWdnZXIuZHJvcERhdGFiYXNlID0gdHJ1ZTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoXy5oYXMoZG9jLm8sICdkcm9wJykpIHtcbiAgICAgICAgICAgICAgdHJpZ2dlci5jb2xsZWN0aW9uID0gZG9jLm8uZHJvcDtcbiAgICAgICAgICAgICAgdHJpZ2dlci5kcm9wQ29sbGVjdGlvbiA9IHRydWU7XG4gICAgICAgICAgICAgIHRyaWdnZXIuaWQgPSBudWxsO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhyb3cgRXJyb3IoXCJVbmtub3duIGNvbW1hbmQgXCIgKyBKU09OLnN0cmluZ2lmeShkb2MpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gQWxsIG90aGVyIG9wcyBoYXZlIGFuIGlkLlxuICAgICAgICAgICAgdHJpZ2dlci5pZCA9IGlkRm9yT3AoZG9jKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBzZWxmLl9jcm9zc2Jhci5maXJlKHRyaWdnZXIpO1xuXG4gICAgICAgICAgLy8gTm93IHRoYXQgd2UndmUgcHJvY2Vzc2VkIHRoaXMgb3BlcmF0aW9uLCBwcm9jZXNzIHBlbmRpbmdcbiAgICAgICAgICAvLyBzZXF1ZW5jZXJzLlxuICAgICAgICAgIGlmICghZG9jLnRzKVxuICAgICAgICAgICAgdGhyb3cgRXJyb3IoXCJvcGxvZyBlbnRyeSB3aXRob3V0IHRzOiBcIiArIEVKU09OLnN0cmluZ2lmeShkb2MpKTtcbiAgICAgICAgICBzZWxmLl9zZXRMYXN0UHJvY2Vzc2VkVFMoZG9jLnRzKTtcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgc2VsZi5fd29ya2VyQWN0aXZlID0gZmFsc2U7XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG4gIF9zZXRMYXN0UHJvY2Vzc2VkVFM6IGZ1bmN0aW9uICh0cykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLl9sYXN0UHJvY2Vzc2VkVFMgPSB0cztcbiAgICB3aGlsZSAoIV8uaXNFbXB0eShzZWxmLl9jYXRjaGluZ1VwRnV0dXJlcykgJiYgc2VsZi5fY2F0Y2hpbmdVcEZ1dHVyZXNbMF0udHMubGVzc1RoYW5PckVxdWFsKHNlbGYuX2xhc3RQcm9jZXNzZWRUUykpIHtcbiAgICAgIHZhciBzZXF1ZW5jZXIgPSBzZWxmLl9jYXRjaGluZ1VwRnV0dXJlcy5zaGlmdCgpO1xuICAgICAgc2VxdWVuY2VyLmZ1dHVyZS5yZXR1cm4oKTtcbiAgICB9XG4gIH0sXG5cbiAgLy9NZXRob2RzIHVzZWQgb24gdGVzdHMgdG8gZGluYW1pY2FsbHkgY2hhbmdlIFRPT19GQVJfQkVISU5EXG4gIF9kZWZpbmVUb29GYXJCZWhpbmQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgVE9PX0ZBUl9CRUhJTkQgPSB2YWx1ZTtcbiAgfSxcbiAgX3Jlc2V0VG9vRmFyQmVoaW5kOiBmdW5jdGlvbigpIHtcbiAgICBUT09fRkFSX0JFSElORCA9IHByb2Nlc3MuZW52Lk1FVEVPUl9PUExPR19UT09fRkFSX0JFSElORCB8fCAyMDAwO1xuICB9XG59KTtcbiIsInZhciBGdXR1cmUgPSBOcG0ucmVxdWlyZSgnZmliZXJzL2Z1dHVyZScpO1xuXG5PYnNlcnZlTXVsdGlwbGV4ZXIgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgaWYgKCFvcHRpb25zIHx8ICFfLmhhcyhvcHRpb25zLCAnb3JkZXJlZCcpKVxuICAgIHRocm93IEVycm9yKFwibXVzdCBzcGVjaWZpZWQgb3JkZXJlZFwiKTtcblxuICBQYWNrYWdlLmZhY3RzICYmIFBhY2thZ2UuZmFjdHMuRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICBcIm1vbmdvLWxpdmVkYXRhXCIsIFwib2JzZXJ2ZS1tdWx0aXBsZXhlcnNcIiwgMSk7XG5cbiAgc2VsZi5fb3JkZXJlZCA9IG9wdGlvbnMub3JkZXJlZDtcbiAgc2VsZi5fb25TdG9wID0gb3B0aW9ucy5vblN0b3AgfHwgZnVuY3Rpb24gKCkge307XG4gIHNlbGYuX3F1ZXVlID0gbmV3IE1ldGVvci5fU3luY2hyb25vdXNRdWV1ZSgpO1xuICBzZWxmLl9oYW5kbGVzID0ge307XG4gIHNlbGYuX3JlYWR5RnV0dXJlID0gbmV3IEZ1dHVyZTtcbiAgc2VsZi5fY2FjaGUgPSBuZXcgTG9jYWxDb2xsZWN0aW9uLl9DYWNoaW5nQ2hhbmdlT2JzZXJ2ZXIoe1xuICAgIG9yZGVyZWQ6IG9wdGlvbnMub3JkZXJlZH0pO1xuICAvLyBOdW1iZXIgb2YgYWRkSGFuZGxlQW5kU2VuZEluaXRpYWxBZGRzIHRhc2tzIHNjaGVkdWxlZCBidXQgbm90IHlldFxuICAvLyBydW5uaW5nLiByZW1vdmVIYW5kbGUgdXNlcyB0aGlzIHRvIGtub3cgaWYgaXQncyB0aW1lIHRvIGNhbGwgdGhlIG9uU3RvcFxuICAvLyBjYWxsYmFjay5cbiAgc2VsZi5fYWRkSGFuZGxlVGFza3NTY2hlZHVsZWRCdXROb3RQZXJmb3JtZWQgPSAwO1xuXG4gIF8uZWFjaChzZWxmLmNhbGxiYWNrTmFtZXMoKSwgZnVuY3Rpb24gKGNhbGxiYWNrTmFtZSkge1xuICAgIHNlbGZbY2FsbGJhY2tOYW1lXSA9IGZ1bmN0aW9uICgvKiAuLi4gKi8pIHtcbiAgICAgIHNlbGYuX2FwcGx5Q2FsbGJhY2soY2FsbGJhY2tOYW1lLCBfLnRvQXJyYXkoYXJndW1lbnRzKSk7XG4gICAgfTtcbiAgfSk7XG59O1xuXG5fLmV4dGVuZChPYnNlcnZlTXVsdGlwbGV4ZXIucHJvdG90eXBlLCB7XG4gIGFkZEhhbmRsZUFuZFNlbmRJbml0aWFsQWRkczogZnVuY3Rpb24gKGhhbmRsZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIC8vIENoZWNrIHRoaXMgYmVmb3JlIGNhbGxpbmcgcnVuVGFzayAoZXZlbiB0aG91Z2ggcnVuVGFzayBkb2VzIHRoZSBzYW1lXG4gICAgLy8gY2hlY2spIHNvIHRoYXQgd2UgZG9uJ3QgbGVhayBhbiBPYnNlcnZlTXVsdGlwbGV4ZXIgb24gZXJyb3IgYnlcbiAgICAvLyBpbmNyZW1lbnRpbmcgX2FkZEhhbmRsZVRhc2tzU2NoZWR1bGVkQnV0Tm90UGVyZm9ybWVkIGFuZCBuZXZlclxuICAgIC8vIGRlY3JlbWVudGluZyBpdC5cbiAgICBpZiAoIXNlbGYuX3F1ZXVlLnNhZmVUb1J1blRhc2soKSlcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbid0IGNhbGwgb2JzZXJ2ZUNoYW5nZXMgZnJvbSBhbiBvYnNlcnZlIGNhbGxiYWNrIG9uIHRoZSBzYW1lIHF1ZXJ5XCIpO1xuICAgICsrc2VsZi5fYWRkSGFuZGxlVGFza3NTY2hlZHVsZWRCdXROb3RQZXJmb3JtZWQ7XG5cbiAgICBQYWNrYWdlLmZhY3RzICYmIFBhY2thZ2UuZmFjdHMuRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgIFwibW9uZ28tbGl2ZWRhdGFcIiwgXCJvYnNlcnZlLWhhbmRsZXNcIiwgMSk7XG5cbiAgICBzZWxmLl9xdWV1ZS5ydW5UYXNrKGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX2hhbmRsZXNbaGFuZGxlLl9pZF0gPSBoYW5kbGU7XG4gICAgICAvLyBTZW5kIG91dCB3aGF0ZXZlciBhZGRzIHdlIGhhdmUgc28gZmFyICh3aGV0aGVyIG9yIG5vdCB3ZSB0aGVcbiAgICAgIC8vIG11bHRpcGxleGVyIGlzIHJlYWR5KS5cbiAgICAgIHNlbGYuX3NlbmRBZGRzKGhhbmRsZSk7XG4gICAgICAtLXNlbGYuX2FkZEhhbmRsZVRhc2tzU2NoZWR1bGVkQnV0Tm90UGVyZm9ybWVkO1xuICAgIH0pO1xuICAgIC8vICpvdXRzaWRlKiB0aGUgdGFzaywgc2luY2Ugb3RoZXJ3aXNlIHdlJ2QgZGVhZGxvY2tcbiAgICBzZWxmLl9yZWFkeUZ1dHVyZS53YWl0KCk7XG4gIH0sXG5cbiAgLy8gUmVtb3ZlIGFuIG9ic2VydmUgaGFuZGxlLiBJZiBpdCB3YXMgdGhlIGxhc3Qgb2JzZXJ2ZSBoYW5kbGUsIGNhbGwgdGhlXG4gIC8vIG9uU3RvcCBjYWxsYmFjazsgeW91IGNhbm5vdCBhZGQgYW55IG1vcmUgb2JzZXJ2ZSBoYW5kbGVzIGFmdGVyIHRoaXMuXG4gIC8vXG4gIC8vIFRoaXMgaXMgbm90IHN5bmNocm9uaXplZCB3aXRoIHBvbGxzIGFuZCBoYW5kbGUgYWRkaXRpb25zOiB0aGlzIG1lYW5zIHRoYXRcbiAgLy8geW91IGNhbiBzYWZlbHkgY2FsbCBpdCBmcm9tIHdpdGhpbiBhbiBvYnNlcnZlIGNhbGxiYWNrLCBidXQgaXQgYWxzbyBtZWFuc1xuICAvLyB0aGF0IHdlIGhhdmUgdG8gYmUgY2FyZWZ1bCB3aGVuIHdlIGl0ZXJhdGUgb3ZlciBfaGFuZGxlcy5cbiAgcmVtb3ZlSGFuZGxlOiBmdW5jdGlvbiAoaWQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAvLyBUaGlzIHNob3VsZCBub3QgYmUgcG9zc2libGU6IHlvdSBjYW4gb25seSBjYWxsIHJlbW92ZUhhbmRsZSBieSBoYXZpbmdcbiAgICAvLyBhY2Nlc3MgdG8gdGhlIE9ic2VydmVIYW5kbGUsIHdoaWNoIGlzbid0IHJldHVybmVkIHRvIHVzZXIgY29kZSB1bnRpbCB0aGVcbiAgICAvLyBtdWx0aXBsZXggaXMgcmVhZHkuXG4gICAgaWYgKCFzZWxmLl9yZWFkeSgpKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgcmVtb3ZlIGhhbmRsZXMgdW50aWwgdGhlIG11bHRpcGxleCBpcyByZWFkeVwiKTtcblxuICAgIGRlbGV0ZSBzZWxmLl9oYW5kbGVzW2lkXTtcblxuICAgIFBhY2thZ2UuZmFjdHMgJiYgUGFja2FnZS5mYWN0cy5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgICAgXCJtb25nby1saXZlZGF0YVwiLCBcIm9ic2VydmUtaGFuZGxlc1wiLCAtMSk7XG5cbiAgICBpZiAoXy5pc0VtcHR5KHNlbGYuX2hhbmRsZXMpICYmXG4gICAgICAgIHNlbGYuX2FkZEhhbmRsZVRhc2tzU2NoZWR1bGVkQnV0Tm90UGVyZm9ybWVkID09PSAwKSB7XG4gICAgICBzZWxmLl9zdG9wKCk7XG4gICAgfVxuICB9LFxuICBfc3RvcDogZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgICAvLyBJdCBzaG91bGRuJ3QgYmUgcG9zc2libGUgZm9yIHVzIHRvIHN0b3Agd2hlbiBhbGwgb3VyIGhhbmRsZXMgc3RpbGxcbiAgICAvLyBoYXZlbid0IGJlZW4gcmV0dXJuZWQgZnJvbSBvYnNlcnZlQ2hhbmdlcyFcbiAgICBpZiAoISBzZWxmLl9yZWFkeSgpICYmICEgb3B0aW9ucy5mcm9tUXVlcnlFcnJvcilcbiAgICAgIHRocm93IEVycm9yKFwic3VycHJpc2luZyBfc3RvcDogbm90IHJlYWR5XCIpO1xuXG4gICAgLy8gQ2FsbCBzdG9wIGNhbGxiYWNrICh3aGljaCBraWxscyB0aGUgdW5kZXJseWluZyBwcm9jZXNzIHdoaWNoIHNlbmRzIHVzXG4gICAgLy8gY2FsbGJhY2tzIGFuZCByZW1vdmVzIHVzIGZyb20gdGhlIGNvbm5lY3Rpb24ncyBkaWN0aW9uYXJ5KS5cbiAgICBzZWxmLl9vblN0b3AoKTtcbiAgICBQYWNrYWdlLmZhY3RzICYmIFBhY2thZ2UuZmFjdHMuRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgIFwibW9uZ28tbGl2ZWRhdGFcIiwgXCJvYnNlcnZlLW11bHRpcGxleGVyc1wiLCAtMSk7XG5cbiAgICAvLyBDYXVzZSBmdXR1cmUgYWRkSGFuZGxlQW5kU2VuZEluaXRpYWxBZGRzIGNhbGxzIHRvIHRocm93IChidXQgdGhlIG9uU3RvcFxuICAgIC8vIGNhbGxiYWNrIHNob3VsZCBtYWtlIG91ciBjb25uZWN0aW9uIGZvcmdldCBhYm91dCB1cykuXG4gICAgc2VsZi5faGFuZGxlcyA9IG51bGw7XG4gIH0sXG5cbiAgLy8gQWxsb3dzIGFsbCBhZGRIYW5kbGVBbmRTZW5kSW5pdGlhbEFkZHMgY2FsbHMgdG8gcmV0dXJuLCBvbmNlIGFsbCBwcmVjZWRpbmdcbiAgLy8gYWRkcyBoYXZlIGJlZW4gcHJvY2Vzc2VkLiBEb2VzIG5vdCBibG9jay5cbiAgcmVhZHk6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5fcXVldWUucXVldWVUYXNrKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmIChzZWxmLl9yZWFkeSgpKVxuICAgICAgICB0aHJvdyBFcnJvcihcImNhbid0IG1ha2UgT2JzZXJ2ZU11bHRpcGxleCByZWFkeSB0d2ljZSFcIik7XG4gICAgICBzZWxmLl9yZWFkeUZ1dHVyZS5yZXR1cm4oKTtcbiAgICB9KTtcbiAgfSxcblxuICAvLyBJZiB0cnlpbmcgdG8gZXhlY3V0ZSB0aGUgcXVlcnkgcmVzdWx0cyBpbiBhbiBlcnJvciwgY2FsbCB0aGlzLiBUaGlzIGlzXG4gIC8vIGludGVuZGVkIGZvciBwZXJtYW5lbnQgZXJyb3JzLCBub3QgdHJhbnNpZW50IG5ldHdvcmsgZXJyb3JzIHRoYXQgY291bGQgYmVcbiAgLy8gZml4ZWQuIEl0IHNob3VsZCBvbmx5IGJlIGNhbGxlZCBiZWZvcmUgcmVhZHkoKSwgYmVjYXVzZSBpZiB5b3UgY2FsbGVkIHJlYWR5XG4gIC8vIHRoYXQgbWVhbnQgdGhhdCB5b3UgbWFuYWdlZCB0byBydW4gdGhlIHF1ZXJ5IG9uY2UuIEl0IHdpbGwgc3RvcCB0aGlzXG4gIC8vIE9ic2VydmVNdWx0aXBsZXggYW5kIGNhdXNlIGFkZEhhbmRsZUFuZFNlbmRJbml0aWFsQWRkcyBjYWxscyAoYW5kIHRodXNcbiAgLy8gb2JzZXJ2ZUNoYW5nZXMgY2FsbHMpIHRvIHRocm93IHRoZSBlcnJvci5cbiAgcXVlcnlFcnJvcjogZnVuY3Rpb24gKGVycikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLl9xdWV1ZS5ydW5UYXNrKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmIChzZWxmLl9yZWFkeSgpKVxuICAgICAgICB0aHJvdyBFcnJvcihcImNhbid0IGNsYWltIHF1ZXJ5IGhhcyBhbiBlcnJvciBhZnRlciBpdCB3b3JrZWQhXCIpO1xuICAgICAgc2VsZi5fc3RvcCh7ZnJvbVF1ZXJ5RXJyb3I6IHRydWV9KTtcbiAgICAgIHNlbGYuX3JlYWR5RnV0dXJlLnRocm93KGVycik7XG4gICAgfSk7XG4gIH0sXG5cbiAgLy8gQ2FsbHMgXCJjYlwiIG9uY2UgdGhlIGVmZmVjdHMgb2YgYWxsIFwicmVhZHlcIiwgXCJhZGRIYW5kbGVBbmRTZW5kSW5pdGlhbEFkZHNcIlxuICAvLyBhbmQgb2JzZXJ2ZSBjYWxsYmFja3Mgd2hpY2ggY2FtZSBiZWZvcmUgdGhpcyBjYWxsIGhhdmUgYmVlbiBwcm9wYWdhdGVkIHRvXG4gIC8vIGFsbCBoYW5kbGVzLiBcInJlYWR5XCIgbXVzdCBoYXZlIGFscmVhZHkgYmVlbiBjYWxsZWQgb24gdGhpcyBtdWx0aXBsZXhlci5cbiAgb25GbHVzaDogZnVuY3Rpb24gKGNiKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuX3F1ZXVlLnF1ZXVlVGFzayhmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAoIXNlbGYuX3JlYWR5KCkpXG4gICAgICAgIHRocm93IEVycm9yKFwib25seSBjYWxsIG9uRmx1c2ggb24gYSBtdWx0aXBsZXhlciB0aGF0IHdpbGwgYmUgcmVhZHlcIik7XG4gICAgICBjYigpO1xuICAgIH0pO1xuICB9LFxuICBjYWxsYmFja05hbWVzOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9vcmRlcmVkKVxuICAgICAgcmV0dXJuIFtcImFkZGVkQmVmb3JlXCIsIFwiY2hhbmdlZFwiLCBcIm1vdmVkQmVmb3JlXCIsIFwicmVtb3ZlZFwiXTtcbiAgICBlbHNlXG4gICAgICByZXR1cm4gW1wiYWRkZWRcIiwgXCJjaGFuZ2VkXCIsIFwicmVtb3ZlZFwiXTtcbiAgfSxcbiAgX3JlYWR5OiBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlYWR5RnV0dXJlLmlzUmVzb2x2ZWQoKTtcbiAgfSxcbiAgX2FwcGx5Q2FsbGJhY2s6IGZ1bmN0aW9uIChjYWxsYmFja05hbWUsIGFyZ3MpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5fcXVldWUucXVldWVUYXNrKGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vIElmIHdlIHN0b3BwZWQgaW4gdGhlIG1lYW50aW1lLCBkbyBub3RoaW5nLlxuICAgICAgaWYgKCFzZWxmLl9oYW5kbGVzKVxuICAgICAgICByZXR1cm47XG5cbiAgICAgIC8vIEZpcnN0LCBhcHBseSB0aGUgY2hhbmdlIHRvIHRoZSBjYWNoZS5cbiAgICAgIC8vIFhYWCBXZSBjb3VsZCBtYWtlIGFwcGx5Q2hhbmdlIGNhbGxiYWNrcyBwcm9taXNlIG5vdCB0byBoYW5nIG9uIHRvIGFueVxuICAgICAgLy8gc3RhdGUgZnJvbSB0aGVpciBhcmd1bWVudHMgKGFzc3VtaW5nIHRoYXQgdGhlaXIgc3VwcGxpZWQgY2FsbGJhY2tzXG4gICAgICAvLyBkb24ndCkgYW5kIHNraXAgdGhpcyBjbG9uZS4gQ3VycmVudGx5ICdjaGFuZ2VkJyBoYW5ncyBvbiB0byBzdGF0ZVxuICAgICAgLy8gdGhvdWdoLlxuICAgICAgc2VsZi5fY2FjaGUuYXBwbHlDaGFuZ2VbY2FsbGJhY2tOYW1lXS5hcHBseShudWxsLCBFSlNPTi5jbG9uZShhcmdzKSk7XG5cbiAgICAgIC8vIElmIHdlIGhhdmVuJ3QgZmluaXNoZWQgdGhlIGluaXRpYWwgYWRkcywgdGhlbiB3ZSBzaG91bGQgb25seSBiZSBnZXR0aW5nXG4gICAgICAvLyBhZGRzLlxuICAgICAgaWYgKCFzZWxmLl9yZWFkeSgpICYmXG4gICAgICAgICAgKGNhbGxiYWNrTmFtZSAhPT0gJ2FkZGVkJyAmJiBjYWxsYmFja05hbWUgIT09ICdhZGRlZEJlZm9yZScpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkdvdCBcIiArIGNhbGxiYWNrTmFtZSArIFwiIGR1cmluZyBpbml0aWFsIGFkZHNcIik7XG4gICAgICB9XG5cbiAgICAgIC8vIE5vdyBtdWx0aXBsZXggdGhlIGNhbGxiYWNrcyBvdXQgdG8gYWxsIG9ic2VydmUgaGFuZGxlcy4gSXQncyBPSyBpZlxuICAgICAgLy8gdGhlc2UgY2FsbHMgeWllbGQ7IHNpbmNlIHdlJ3JlIGluc2lkZSBhIHRhc2ssIG5vIG90aGVyIHVzZSBvZiBvdXIgcXVldWVcbiAgICAgIC8vIGNhbiBjb250aW51ZSB1bnRpbCB0aGVzZSBhcmUgZG9uZS4gKEJ1dCB3ZSBkbyBoYXZlIHRvIGJlIGNhcmVmdWwgdG8gbm90XG4gICAgICAvLyB1c2UgYSBoYW5kbGUgdGhhdCBnb3QgcmVtb3ZlZCwgYmVjYXVzZSByZW1vdmVIYW5kbGUgZG9lcyBub3QgdXNlIHRoZVxuICAgICAgLy8gcXVldWU7IHRodXMsIHdlIGl0ZXJhdGUgb3ZlciBhbiBhcnJheSBvZiBrZXlzIHRoYXQgd2UgY29udHJvbC4pXG4gICAgICBfLmVhY2goXy5rZXlzKHNlbGYuX2hhbmRsZXMpLCBmdW5jdGlvbiAoaGFuZGxlSWQpIHtcbiAgICAgICAgdmFyIGhhbmRsZSA9IHNlbGYuX2hhbmRsZXMgJiYgc2VsZi5faGFuZGxlc1toYW5kbGVJZF07XG4gICAgICAgIGlmICghaGFuZGxlKVxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gaGFuZGxlWydfJyArIGNhbGxiYWNrTmFtZV07XG4gICAgICAgIC8vIGNsb25lIGFyZ3VtZW50cyBzbyB0aGF0IGNhbGxiYWNrcyBjYW4gbXV0YXRlIHRoZWlyIGFyZ3VtZW50c1xuICAgICAgICBjYWxsYmFjayAmJiBjYWxsYmFjay5hcHBseShudWxsLCBFSlNPTi5jbG9uZShhcmdzKSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSxcblxuICAvLyBTZW5kcyBpbml0aWFsIGFkZHMgdG8gYSBoYW5kbGUuIEl0IHNob3VsZCBvbmx5IGJlIGNhbGxlZCBmcm9tIHdpdGhpbiBhIHRhc2tcbiAgLy8gKHRoZSB0YXNrIHRoYXQgaXMgcHJvY2Vzc2luZyB0aGUgYWRkSGFuZGxlQW5kU2VuZEluaXRpYWxBZGRzIGNhbGwpLiBJdFxuICAvLyBzeW5jaHJvbm91c2x5IGludm9rZXMgdGhlIGhhbmRsZSdzIGFkZGVkIG9yIGFkZGVkQmVmb3JlOyB0aGVyZSdzIG5vIG5lZWQgdG9cbiAgLy8gZmx1c2ggdGhlIHF1ZXVlIGFmdGVyd2FyZHMgdG8gZW5zdXJlIHRoYXQgdGhlIGNhbGxiYWNrcyBnZXQgb3V0LlxuICBfc2VuZEFkZHM6IGZ1bmN0aW9uIChoYW5kbGUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3F1ZXVlLnNhZmVUb1J1blRhc2soKSlcbiAgICAgIHRocm93IEVycm9yKFwiX3NlbmRBZGRzIG1heSBvbmx5IGJlIGNhbGxlZCBmcm9tIHdpdGhpbiBhIHRhc2shXCIpO1xuICAgIHZhciBhZGQgPSBzZWxmLl9vcmRlcmVkID8gaGFuZGxlLl9hZGRlZEJlZm9yZSA6IGhhbmRsZS5fYWRkZWQ7XG4gICAgaWYgKCFhZGQpXG4gICAgICByZXR1cm47XG4gICAgLy8gbm90ZTogZG9jcyBtYXkgYmUgYW4gX0lkTWFwIG9yIGFuIE9yZGVyZWREaWN0XG4gICAgc2VsZi5fY2FjaGUuZG9jcy5mb3JFYWNoKGZ1bmN0aW9uIChkb2MsIGlkKSB7XG4gICAgICBpZiAoIV8uaGFzKHNlbGYuX2hhbmRsZXMsIGhhbmRsZS5faWQpKVxuICAgICAgICB0aHJvdyBFcnJvcihcImhhbmRsZSBnb3QgcmVtb3ZlZCBiZWZvcmUgc2VuZGluZyBpbml0aWFsIGFkZHMhXCIpO1xuICAgICAgdmFyIGZpZWxkcyA9IEVKU09OLmNsb25lKGRvYyk7XG4gICAgICBkZWxldGUgZmllbGRzLl9pZDtcbiAgICAgIGlmIChzZWxmLl9vcmRlcmVkKVxuICAgICAgICBhZGQoaWQsIGZpZWxkcywgbnVsbCk7IC8vIHdlJ3JlIGdvaW5nIGluIG9yZGVyLCBzbyBhZGQgYXQgZW5kXG4gICAgICBlbHNlXG4gICAgICAgIGFkZChpZCwgZmllbGRzKTtcbiAgICB9KTtcbiAgfVxufSk7XG5cblxudmFyIG5leHRPYnNlcnZlSGFuZGxlSWQgPSAxO1xuT2JzZXJ2ZUhhbmRsZSA9IGZ1bmN0aW9uIChtdWx0aXBsZXhlciwgY2FsbGJhY2tzKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgLy8gVGhlIGVuZCB1c2VyIGlzIG9ubHkgc3VwcG9zZWQgdG8gY2FsbCBzdG9wKCkuICBUaGUgb3RoZXIgZmllbGRzIGFyZVxuICAvLyBhY2Nlc3NpYmxlIHRvIHRoZSBtdWx0aXBsZXhlciwgdGhvdWdoLlxuICBzZWxmLl9tdWx0aXBsZXhlciA9IG11bHRpcGxleGVyO1xuICBfLmVhY2gobXVsdGlwbGV4ZXIuY2FsbGJhY2tOYW1lcygpLCBmdW5jdGlvbiAobmFtZSkge1xuICAgIGlmIChjYWxsYmFja3NbbmFtZV0pIHtcbiAgICAgIHNlbGZbJ18nICsgbmFtZV0gPSBjYWxsYmFja3NbbmFtZV07XG4gICAgfSBlbHNlIGlmIChuYW1lID09PSBcImFkZGVkQmVmb3JlXCIgJiYgY2FsbGJhY2tzLmFkZGVkKSB7XG4gICAgICAvLyBTcGVjaWFsIGNhc2U6IGlmIHlvdSBzcGVjaWZ5IFwiYWRkZWRcIiBhbmQgXCJtb3ZlZEJlZm9yZVwiLCB5b3UgZ2V0IGFuXG4gICAgICAvLyBvcmRlcmVkIG9ic2VydmUgd2hlcmUgZm9yIHNvbWUgcmVhc29uIHlvdSBkb24ndCBnZXQgb3JkZXJpbmcgZGF0YSBvblxuICAgICAgLy8gdGhlIGFkZHMuICBJIGR1bm5vLCB3ZSB3cm90ZSB0ZXN0cyBmb3IgaXQsIHRoZXJlIG11c3QgaGF2ZSBiZWVuIGFcbiAgICAgIC8vIHJlYXNvbi5cbiAgICAgIHNlbGYuX2FkZGVkQmVmb3JlID0gZnVuY3Rpb24gKGlkLCBmaWVsZHMsIGJlZm9yZSkge1xuICAgICAgICBjYWxsYmFja3MuYWRkZWQoaWQsIGZpZWxkcyk7XG4gICAgICB9O1xuICAgIH1cbiAgfSk7XG4gIHNlbGYuX3N0b3BwZWQgPSBmYWxzZTtcbiAgc2VsZi5faWQgPSBuZXh0T2JzZXJ2ZUhhbmRsZUlkKys7XG59O1xuT2JzZXJ2ZUhhbmRsZS5wcm90b3R5cGUuc3RvcCA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICByZXR1cm47XG4gIHNlbGYuX3N0b3BwZWQgPSB0cnVlO1xuICBzZWxmLl9tdWx0aXBsZXhlci5yZW1vdmVIYW5kbGUoc2VsZi5faWQpO1xufTtcbiIsInZhciBGaWJlciA9IE5wbS5yZXF1aXJlKCdmaWJlcnMnKTtcbnZhciBGdXR1cmUgPSBOcG0ucmVxdWlyZSgnZmliZXJzL2Z1dHVyZScpO1xuXG5Eb2NGZXRjaGVyID0gZnVuY3Rpb24gKG1vbmdvQ29ubmVjdGlvbikge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHNlbGYuX21vbmdvQ29ubmVjdGlvbiA9IG1vbmdvQ29ubmVjdGlvbjtcbiAgLy8gTWFwIGZyb20gY2FjaGUga2V5IC0+IFtjYWxsYmFja11cbiAgc2VsZi5fY2FsbGJhY2tzRm9yQ2FjaGVLZXkgPSB7fTtcbn07XG5cbl8uZXh0ZW5kKERvY0ZldGNoZXIucHJvdG90eXBlLCB7XG4gIC8vIEZldGNoZXMgZG9jdW1lbnQgXCJpZFwiIGZyb20gY29sbGVjdGlvbk5hbWUsIHJldHVybmluZyBpdCBvciBudWxsIGlmIG5vdFxuICAvLyBmb3VuZC5cbiAgLy9cbiAgLy8gSWYgeW91IG1ha2UgbXVsdGlwbGUgY2FsbHMgdG8gZmV0Y2goKSB3aXRoIHRoZSBzYW1lIGNhY2hlS2V5IChhIHN0cmluZyksXG4gIC8vIERvY0ZldGNoZXIgbWF5IGFzc3VtZSB0aGF0IHRoZXkgYWxsIHJldHVybiB0aGUgc2FtZSBkb2N1bWVudC4gKEl0IGRvZXNcbiAgLy8gbm90IGNoZWNrIHRvIHNlZSBpZiBjb2xsZWN0aW9uTmFtZS9pZCBtYXRjaC4pXG4gIC8vXG4gIC8vIFlvdSBtYXkgYXNzdW1lIHRoYXQgY2FsbGJhY2sgaXMgbmV2ZXIgY2FsbGVkIHN5bmNocm9ub3VzbHkgKGFuZCBpbiBmYWN0XG4gIC8vIE9wbG9nT2JzZXJ2ZURyaXZlciBkb2VzIHNvKS5cbiAgZmV0Y2g6IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgaWQsIGNhY2hlS2V5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIGNoZWNrKGNvbGxlY3Rpb25OYW1lLCBTdHJpbmcpO1xuICAgIC8vIGlkIGlzIHNvbWUgc29ydCBvZiBzY2FsYXJcbiAgICBjaGVjayhjYWNoZUtleSwgU3RyaW5nKTtcblxuICAgIC8vIElmIHRoZXJlJ3MgYWxyZWFkeSBhbiBpbi1wcm9ncmVzcyBmZXRjaCBmb3IgdGhpcyBjYWNoZSBrZXksIHlpZWxkIHVudGlsXG4gICAgLy8gaXQncyBkb25lIGFuZCByZXR1cm4gd2hhdGV2ZXIgaXQgcmV0dXJucy5cbiAgICBpZiAoXy5oYXMoc2VsZi5fY2FsbGJhY2tzRm9yQ2FjaGVLZXksIGNhY2hlS2V5KSkge1xuICAgICAgc2VsZi5fY2FsbGJhY2tzRm9yQ2FjaGVLZXlbY2FjaGVLZXldLnB1c2goY2FsbGJhY2spO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBjYWxsYmFja3MgPSBzZWxmLl9jYWxsYmFja3NGb3JDYWNoZUtleVtjYWNoZUtleV0gPSBbY2FsbGJhY2tdO1xuXG4gICAgRmliZXIoZnVuY3Rpb24gKCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdmFyIGRvYyA9IHNlbGYuX21vbmdvQ29ubmVjdGlvbi5maW5kT25lKFxuICAgICAgICAgIGNvbGxlY3Rpb25OYW1lLCB7X2lkOiBpZH0pIHx8IG51bGw7XG4gICAgICAgIC8vIFJldHVybiBkb2MgdG8gYWxsIHJlbGV2YW50IGNhbGxiYWNrcy4gTm90ZSB0aGF0IHRoaXMgYXJyYXkgY2FuXG4gICAgICAgIC8vIGNvbnRpbnVlIHRvIGdyb3cgZHVyaW5nIGNhbGxiYWNrIGV4Y2VjdXRpb24uXG4gICAgICAgIHdoaWxlICghXy5pc0VtcHR5KGNhbGxiYWNrcykpIHtcbiAgICAgICAgICAvLyBDbG9uZSB0aGUgZG9jdW1lbnQgc28gdGhhdCB0aGUgdmFyaW91cyBjYWxscyB0byBmZXRjaCBkb24ndCByZXR1cm5cbiAgICAgICAgICAvLyBvYmplY3RzIHRoYXQgYXJlIGludGVydHdpbmdsZWQgd2l0aCBlYWNoIG90aGVyLiBDbG9uZSBiZWZvcmVcbiAgICAgICAgICAvLyBwb3BwaW5nIHRoZSBmdXR1cmUsIHNvIHRoYXQgaWYgY2xvbmUgdGhyb3dzLCB0aGUgZXJyb3IgZ2V0cyBwYXNzZWRcbiAgICAgICAgICAvLyB0byB0aGUgbmV4dCBjYWxsYmFjay5cbiAgICAgICAgICB2YXIgY2xvbmVkRG9jID0gRUpTT04uY2xvbmUoZG9jKTtcbiAgICAgICAgICBjYWxsYmFja3MucG9wKCkobnVsbCwgY2xvbmVkRG9jKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICB3aGlsZSAoIV8uaXNFbXB0eShjYWxsYmFja3MpKSB7XG4gICAgICAgICAgY2FsbGJhY2tzLnBvcCgpKGUpO1xuICAgICAgICB9XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICAvLyBYWFggY29uc2lkZXIga2VlcGluZyB0aGUgZG9jIGFyb3VuZCBmb3IgYSBwZXJpb2Qgb2YgdGltZSBiZWZvcmVcbiAgICAgICAgLy8gcmVtb3ZpbmcgZnJvbSB0aGUgY2FjaGVcbiAgICAgICAgZGVsZXRlIHNlbGYuX2NhbGxiYWNrc0ZvckNhY2hlS2V5W2NhY2hlS2V5XTtcbiAgICAgIH1cbiAgICB9KS5ydW4oKTtcbiAgfVxufSk7XG5cbk1vbmdvVGVzdC5Eb2NGZXRjaGVyID0gRG9jRmV0Y2hlcjtcbiIsIlBvbGxpbmdPYnNlcnZlRHJpdmVyID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uID0gb3B0aW9ucy5jdXJzb3JEZXNjcmlwdGlvbjtcbiAgc2VsZi5fbW9uZ29IYW5kbGUgPSBvcHRpb25zLm1vbmdvSGFuZGxlO1xuICBzZWxmLl9vcmRlcmVkID0gb3B0aW9ucy5vcmRlcmVkO1xuICBzZWxmLl9tdWx0aXBsZXhlciA9IG9wdGlvbnMubXVsdGlwbGV4ZXI7XG4gIHNlbGYuX3N0b3BDYWxsYmFja3MgPSBbXTtcbiAgc2VsZi5fc3RvcHBlZCA9IGZhbHNlO1xuXG4gIHNlbGYuX3N5bmNocm9ub3VzQ3Vyc29yID0gc2VsZi5fbW9uZ29IYW5kbGUuX2NyZWF0ZVN5bmNocm9ub3VzQ3Vyc29yKFxuICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uKTtcblxuICAvLyBwcmV2aW91cyByZXN1bHRzIHNuYXBzaG90LiAgb24gZWFjaCBwb2xsIGN5Y2xlLCBkaWZmcyBhZ2FpbnN0XG4gIC8vIHJlc3VsdHMgZHJpdmVzIHRoZSBjYWxsYmFja3MuXG4gIHNlbGYuX3Jlc3VsdHMgPSBudWxsO1xuXG4gIC8vIFRoZSBudW1iZXIgb2YgX3BvbGxNb25nbyBjYWxscyB0aGF0IGhhdmUgYmVlbiBhZGRlZCB0byBzZWxmLl90YXNrUXVldWUgYnV0XG4gIC8vIGhhdmUgbm90IHN0YXJ0ZWQgcnVubmluZy4gVXNlZCB0byBtYWtlIHN1cmUgd2UgbmV2ZXIgc2NoZWR1bGUgbW9yZSB0aGFuIG9uZVxuICAvLyBfcG9sbE1vbmdvIChvdGhlciB0aGFuIHBvc3NpYmx5IHRoZSBvbmUgdGhhdCBpcyBjdXJyZW50bHkgcnVubmluZykuIEl0J3NcbiAgLy8gYWxzbyB1c2VkIGJ5IF9zdXNwZW5kUG9sbGluZyB0byBwcmV0ZW5kIHRoZXJlJ3MgYSBwb2xsIHNjaGVkdWxlZC4gVXN1YWxseSxcbiAgLy8gaXQncyBlaXRoZXIgMCAoZm9yIFwibm8gcG9sbHMgc2NoZWR1bGVkIG90aGVyIHRoYW4gbWF5YmUgb25lIGN1cnJlbnRseVxuICAvLyBydW5uaW5nXCIpIG9yIDEgKGZvciBcImEgcG9sbCBzY2hlZHVsZWQgdGhhdCBpc24ndCBydW5uaW5nIHlldFwiKSwgYnV0IGl0IGNhblxuICAvLyBhbHNvIGJlIDIgaWYgaW5jcmVtZW50ZWQgYnkgX3N1c3BlbmRQb2xsaW5nLlxuICBzZWxmLl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQgPSAwO1xuICBzZWxmLl9wZW5kaW5nV3JpdGVzID0gW107IC8vIHBlb3BsZSB0byBub3RpZnkgd2hlbiBwb2xsaW5nIGNvbXBsZXRlc1xuXG4gIC8vIE1ha2Ugc3VyZSB0byBjcmVhdGUgYSBzZXBhcmF0ZWx5IHRocm90dGxlZCBmdW5jdGlvbiBmb3IgZWFjaFxuICAvLyBQb2xsaW5nT2JzZXJ2ZURyaXZlciBvYmplY3QuXG4gIHNlbGYuX2Vuc3VyZVBvbGxJc1NjaGVkdWxlZCA9IF8udGhyb3R0bGUoXG4gICAgc2VsZi5fdW50aHJvdHRsZWRFbnN1cmVQb2xsSXNTY2hlZHVsZWQsXG4gICAgc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy5wb2xsaW5nVGhyb3R0bGVNcyB8fCA1MCAvKiBtcyAqLyk7XG5cbiAgLy8gWFhYIGZpZ3VyZSBvdXQgaWYgd2Ugc3RpbGwgbmVlZCBhIHF1ZXVlXG4gIHNlbGYuX3Rhc2tRdWV1ZSA9IG5ldyBNZXRlb3IuX1N5bmNocm9ub3VzUXVldWUoKTtcblxuICB2YXIgbGlzdGVuZXJzSGFuZGxlID0gbGlzdGVuQWxsKFxuICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLCBmdW5jdGlvbiAobm90aWZpY2F0aW9uKSB7XG4gICAgICAvLyBXaGVuIHNvbWVvbmUgZG9lcyBhIHRyYW5zYWN0aW9uIHRoYXQgbWlnaHQgYWZmZWN0IHVzLCBzY2hlZHVsZSBhIHBvbGxcbiAgICAgIC8vIG9mIHRoZSBkYXRhYmFzZS4gSWYgdGhhdCB0cmFuc2FjdGlvbiBoYXBwZW5zIGluc2lkZSBvZiBhIHdyaXRlIGZlbmNlLFxuICAgICAgLy8gYmxvY2sgdGhlIGZlbmNlIHVudGlsIHdlJ3ZlIHBvbGxlZCBhbmQgbm90aWZpZWQgb2JzZXJ2ZXJzLlxuICAgICAgdmFyIGZlbmNlID0gRERQU2VydmVyLl9DdXJyZW50V3JpdGVGZW5jZS5nZXQoKTtcbiAgICAgIGlmIChmZW5jZSlcbiAgICAgICAgc2VsZi5fcGVuZGluZ1dyaXRlcy5wdXNoKGZlbmNlLmJlZ2luV3JpdGUoKSk7XG4gICAgICAvLyBFbnN1cmUgYSBwb2xsIGlzIHNjaGVkdWxlZC4uLiBidXQgaWYgd2UgYWxyZWFkeSBrbm93IHRoYXQgb25lIGlzLFxuICAgICAgLy8gZG9uJ3QgaGl0IHRoZSB0aHJvdHRsZWQgX2Vuc3VyZVBvbGxJc1NjaGVkdWxlZCBmdW5jdGlvbiAod2hpY2ggbWlnaHRcbiAgICAgIC8vIGxlYWQgdG8gdXMgY2FsbGluZyBpdCB1bm5lY2Vzc2FyaWx5IGluIDxwb2xsaW5nVGhyb3R0bGVNcz4gbXMpLlxuICAgICAgaWYgKHNlbGYuX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCA9PT0gMClcbiAgICAgICAgc2VsZi5fZW5zdXJlUG9sbElzU2NoZWR1bGVkKCk7XG4gICAgfVxuICApO1xuICBzZWxmLl9zdG9wQ2FsbGJhY2tzLnB1c2goZnVuY3Rpb24gKCkgeyBsaXN0ZW5lcnNIYW5kbGUuc3RvcCgpOyB9KTtcblxuICAvLyBldmVyeSBvbmNlIGFuZCBhIHdoaWxlLCBwb2xsIGV2ZW4gaWYgd2UgZG9uJ3QgdGhpbmsgd2UncmUgZGlydHksIGZvclxuICAvLyBldmVudHVhbCBjb25zaXN0ZW5jeSB3aXRoIGRhdGFiYXNlIHdyaXRlcyBmcm9tIG91dHNpZGUgdGhlIE1ldGVvclxuICAvLyB1bml2ZXJzZS5cbiAgLy9cbiAgLy8gRm9yIHRlc3RpbmcsIHRoZXJlJ3MgYW4gdW5kb2N1bWVudGVkIGNhbGxiYWNrIGFyZ3VtZW50IHRvIG9ic2VydmVDaGFuZ2VzXG4gIC8vIHdoaWNoIGRpc2FibGVzIHRpbWUtYmFzZWQgcG9sbGluZyBhbmQgZ2V0cyBjYWxsZWQgYXQgdGhlIGJlZ2lubmluZyBvZiBlYWNoXG4gIC8vIHBvbGwuXG4gIGlmIChvcHRpb25zLl90ZXN0T25seVBvbGxDYWxsYmFjaykge1xuICAgIHNlbGYuX3Rlc3RPbmx5UG9sbENhbGxiYWNrID0gb3B0aW9ucy5fdGVzdE9ubHlQb2xsQ2FsbGJhY2s7XG4gIH0gZWxzZSB7XG4gICAgdmFyIHBvbGxpbmdJbnRlcnZhbCA9XG4gICAgICAgICAgc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy5wb2xsaW5nSW50ZXJ2YWxNcyB8fFxuICAgICAgICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMuX3BvbGxpbmdJbnRlcnZhbCB8fCAvLyBDT01QQVQgd2l0aCAxLjJcbiAgICAgICAgICAxMCAqIDEwMDA7XG4gICAgdmFyIGludGVydmFsSGFuZGxlID0gTWV0ZW9yLnNldEludGVydmFsKFxuICAgICAgXy5iaW5kKHNlbGYuX2Vuc3VyZVBvbGxJc1NjaGVkdWxlZCwgc2VsZiksIHBvbGxpbmdJbnRlcnZhbCk7XG4gICAgc2VsZi5fc3RvcENhbGxiYWNrcy5wdXNoKGZ1bmN0aW9uICgpIHtcbiAgICAgIE1ldGVvci5jbGVhckludGVydmFsKGludGVydmFsSGFuZGxlKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIE1ha2Ugc3VyZSB3ZSBhY3R1YWxseSBwb2xsIHNvb24hXG4gIHNlbGYuX3VudGhyb3R0bGVkRW5zdXJlUG9sbElzU2NoZWR1bGVkKCk7XG5cbiAgUGFja2FnZS5mYWN0cyAmJiBQYWNrYWdlLmZhY3RzLkZhY3RzLmluY3JlbWVudFNlcnZlckZhY3QoXG4gICAgXCJtb25nby1saXZlZGF0YVwiLCBcIm9ic2VydmUtZHJpdmVycy1wb2xsaW5nXCIsIDEpO1xufTtcblxuXy5leHRlbmQoUG9sbGluZ09ic2VydmVEcml2ZXIucHJvdG90eXBlLCB7XG4gIC8vIFRoaXMgaXMgYWx3YXlzIGNhbGxlZCB0aHJvdWdoIF8udGhyb3R0bGUgKGV4Y2VwdCBvbmNlIGF0IHN0YXJ0dXApLlxuICBfdW50aHJvdHRsZWRFbnN1cmVQb2xsSXNTY2hlZHVsZWQ6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCA+IDApXG4gICAgICByZXR1cm47XG4gICAgKytzZWxmLl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQ7XG4gICAgc2VsZi5fdGFza1F1ZXVlLnF1ZXVlVGFzayhmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9wb2xsTW9uZ28oKTtcbiAgICB9KTtcbiAgfSxcblxuICAvLyB0ZXN0LW9ubHkgaW50ZXJmYWNlIGZvciBjb250cm9sbGluZyBwb2xsaW5nLlxuICAvL1xuICAvLyBfc3VzcGVuZFBvbGxpbmcgYmxvY2tzIHVudGlsIGFueSBjdXJyZW50bHkgcnVubmluZyBhbmQgc2NoZWR1bGVkIHBvbGxzIGFyZVxuICAvLyBkb25lLCBhbmQgcHJldmVudHMgYW55IGZ1cnRoZXIgcG9sbHMgZnJvbSBiZWluZyBzY2hlZHVsZWQuIChuZXdcbiAgLy8gT2JzZXJ2ZUhhbmRsZXMgY2FuIGJlIGFkZGVkIGFuZCByZWNlaXZlIHRoZWlyIGluaXRpYWwgYWRkZWQgY2FsbGJhY2tzLFxuICAvLyB0aG91Z2guKVxuICAvL1xuICAvLyBfcmVzdW1lUG9sbGluZyBpbW1lZGlhdGVseSBwb2xscywgYW5kIGFsbG93cyBmdXJ0aGVyIHBvbGxzIHRvIG9jY3VyLlxuICBfc3VzcGVuZFBvbGxpbmc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyBQcmV0ZW5kIHRoYXQgdGhlcmUncyBhbm90aGVyIHBvbGwgc2NoZWR1bGVkICh3aGljaCB3aWxsIHByZXZlbnRcbiAgICAvLyBfZW5zdXJlUG9sbElzU2NoZWR1bGVkIGZyb20gcXVldWVpbmcgYW55IG1vcmUgcG9sbHMpLlxuICAgICsrc2VsZi5fcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkO1xuICAgIC8vIE5vdyBibG9jayB1bnRpbCBhbGwgY3VycmVudGx5IHJ1bm5pbmcgb3Igc2NoZWR1bGVkIHBvbGxzIGFyZSBkb25lLlxuICAgIHNlbGYuX3Rhc2tRdWV1ZS5ydW5UYXNrKGZ1bmN0aW9uKCkge30pO1xuXG4gICAgLy8gQ29uZmlybSB0aGF0IHRoZXJlIGlzIG9ubHkgb25lIFwicG9sbFwiICh0aGUgZmFrZSBvbmUgd2UncmUgcHJldGVuZGluZyB0b1xuICAgIC8vIGhhdmUpIHNjaGVkdWxlZC5cbiAgICBpZiAoc2VsZi5fcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkICE9PSAxKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCBpcyBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgc2VsZi5fcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkKTtcbiAgfSxcbiAgX3Jlc3VtZVBvbGxpbmc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyBXZSBzaG91bGQgYmUgaW4gdGhlIHNhbWUgc3RhdGUgYXMgaW4gdGhlIGVuZCBvZiBfc3VzcGVuZFBvbGxpbmcuXG4gICAgaWYgKHNlbGYuX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCAhPT0gMSlcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQgaXMgXCIgK1xuICAgICAgICAgICAgICAgICAgICAgIHNlbGYuX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCk7XG4gICAgLy8gUnVuIGEgcG9sbCBzeW5jaHJvbm91c2x5ICh3aGljaCB3aWxsIGNvdW50ZXJhY3QgdGhlXG4gICAgLy8gKytfcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkIGZyb20gX3N1c3BlbmRQb2xsaW5nKS5cbiAgICBzZWxmLl90YXNrUXVldWUucnVuVGFzayhmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9wb2xsTW9uZ28oKTtcbiAgICB9KTtcbiAgfSxcblxuICBfcG9sbE1vbmdvOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIC0tc2VsZi5fcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkO1xuXG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47XG5cbiAgICB2YXIgZmlyc3QgPSBmYWxzZTtcbiAgICB2YXIgbmV3UmVzdWx0cztcbiAgICB2YXIgb2xkUmVzdWx0cyA9IHNlbGYuX3Jlc3VsdHM7XG4gICAgaWYgKCFvbGRSZXN1bHRzKSB7XG4gICAgICBmaXJzdCA9IHRydWU7XG4gICAgICAvLyBYWFggbWF5YmUgdXNlIE9yZGVyZWREaWN0IGluc3RlYWQ/XG4gICAgICBvbGRSZXN1bHRzID0gc2VsZi5fb3JkZXJlZCA/IFtdIDogbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gICAgfVxuXG4gICAgc2VsZi5fdGVzdE9ubHlQb2xsQ2FsbGJhY2sgJiYgc2VsZi5fdGVzdE9ubHlQb2xsQ2FsbGJhY2soKTtcblxuICAgIC8vIFNhdmUgdGhlIGxpc3Qgb2YgcGVuZGluZyB3cml0ZXMgd2hpY2ggdGhpcyByb3VuZCB3aWxsIGNvbW1pdC5cbiAgICB2YXIgd3JpdGVzRm9yQ3ljbGUgPSBzZWxmLl9wZW5kaW5nV3JpdGVzO1xuICAgIHNlbGYuX3BlbmRpbmdXcml0ZXMgPSBbXTtcblxuICAgIC8vIEdldCB0aGUgbmV3IHF1ZXJ5IHJlc3VsdHMuIChUaGlzIHlpZWxkcy4pXG4gICAgdHJ5IHtcbiAgICAgIG5ld1Jlc3VsdHMgPSBzZWxmLl9zeW5jaHJvbm91c0N1cnNvci5nZXRSYXdPYmplY3RzKHNlbGYuX29yZGVyZWQpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChmaXJzdCAmJiB0eXBlb2YoZS5jb2RlKSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgLy8gVGhpcyBpcyBhbiBlcnJvciBkb2N1bWVudCBzZW50IHRvIHVzIGJ5IG1vbmdvZCwgbm90IGEgY29ubmVjdGlvblxuICAgICAgICAvLyBlcnJvciBnZW5lcmF0ZWQgYnkgdGhlIGNsaWVudC4gQW5kIHdlJ3ZlIG5ldmVyIHNlZW4gdGhpcyBxdWVyeSB3b3JrXG4gICAgICAgIC8vIHN1Y2Nlc3NmdWxseS4gUHJvYmFibHkgaXQncyBhIGJhZCBzZWxlY3RvciBvciBzb21ldGhpbmcsIHNvIHdlIHNob3VsZFxuICAgICAgICAvLyBOT1QgcmV0cnkuIEluc3RlYWQsIHdlIHNob3VsZCBoYWx0IHRoZSBvYnNlcnZlICh3aGljaCBlbmRzIHVwIGNhbGxpbmdcbiAgICAgICAgLy8gYHN0b3BgIG9uIHVzKS5cbiAgICAgICAgc2VsZi5fbXVsdGlwbGV4ZXIucXVlcnlFcnJvcihcbiAgICAgICAgICBuZXcgRXJyb3IoXG4gICAgICAgICAgICBcIkV4Y2VwdGlvbiB3aGlsZSBwb2xsaW5nIHF1ZXJ5IFwiICtcbiAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkoc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24pICsgXCI6IFwiICsgZS5tZXNzYWdlKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gZ2V0UmF3T2JqZWN0cyBjYW4gdGhyb3cgaWYgd2UncmUgaGF2aW5nIHRyb3VibGUgdGFsa2luZyB0byB0aGVcbiAgICAgIC8vIGRhdGFiYXNlLiAgVGhhdCdzIGZpbmUgLS0tIHdlIHdpbGwgcmVwb2xsIGxhdGVyIGFueXdheS4gQnV0IHdlIHNob3VsZFxuICAgICAgLy8gbWFrZSBzdXJlIG5vdCB0byBsb3NlIHRyYWNrIG9mIHRoaXMgY3ljbGUncyB3cml0ZXMuXG4gICAgICAvLyAoSXQgYWxzbyBjYW4gdGhyb3cgaWYgdGhlcmUncyBqdXN0IHNvbWV0aGluZyBpbnZhbGlkIGFib3V0IHRoaXMgcXVlcnk7XG4gICAgICAvLyB1bmZvcnR1bmF0ZWx5IHRoZSBPYnNlcnZlRHJpdmVyIEFQSSBkb2Vzbid0IHByb3ZpZGUgYSBnb29kIHdheSB0b1xuICAgICAgLy8gXCJjYW5jZWxcIiB0aGUgb2JzZXJ2ZSBmcm9tIHRoZSBpbnNpZGUgaW4gdGhpcyBjYXNlLlxuICAgICAgQXJyYXkucHJvdG90eXBlLnB1c2guYXBwbHkoc2VsZi5fcGVuZGluZ1dyaXRlcywgd3JpdGVzRm9yQ3ljbGUpO1xuICAgICAgTWV0ZW9yLl9kZWJ1ZyhcIkV4Y2VwdGlvbiB3aGlsZSBwb2xsaW5nIHF1ZXJ5IFwiICtcbiAgICAgICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkoc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24pICsgXCI6IFwiICsgZS5zdGFjayk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gUnVuIGRpZmZzLlxuICAgIGlmICghc2VsZi5fc3RvcHBlZCkge1xuICAgICAgTG9jYWxDb2xsZWN0aW9uLl9kaWZmUXVlcnlDaGFuZ2VzKFxuICAgICAgICBzZWxmLl9vcmRlcmVkLCBvbGRSZXN1bHRzLCBuZXdSZXN1bHRzLCBzZWxmLl9tdWx0aXBsZXhlcik7XG4gICAgfVxuXG4gICAgLy8gU2lnbmFscyB0aGUgbXVsdGlwbGV4ZXIgdG8gYWxsb3cgYWxsIG9ic2VydmVDaGFuZ2VzIGNhbGxzIHRoYXQgc2hhcmUgdGhpc1xuICAgIC8vIG11bHRpcGxleGVyIHRvIHJldHVybi4gKFRoaXMgaGFwcGVucyBhc3luY2hyb25vdXNseSwgdmlhIHRoZVxuICAgIC8vIG11bHRpcGxleGVyJ3MgcXVldWUuKVxuICAgIGlmIChmaXJzdClcbiAgICAgIHNlbGYuX211bHRpcGxleGVyLnJlYWR5KCk7XG5cbiAgICAvLyBSZXBsYWNlIHNlbGYuX3Jlc3VsdHMgYXRvbWljYWxseS4gIChUaGlzIGFzc2lnbm1lbnQgaXMgd2hhdCBtYWtlcyBgZmlyc3RgXG4gICAgLy8gc3RheSB0aHJvdWdoIG9uIHRoZSBuZXh0IGN5Y2xlLCBzbyB3ZSd2ZSB3YWl0ZWQgdW50aWwgYWZ0ZXIgd2UndmVcbiAgICAvLyBjb21taXR0ZWQgdG8gcmVhZHktaW5nIHRoZSBtdWx0aXBsZXhlci4pXG4gICAgc2VsZi5fcmVzdWx0cyA9IG5ld1Jlc3VsdHM7XG5cbiAgICAvLyBPbmNlIHRoZSBPYnNlcnZlTXVsdGlwbGV4ZXIgaGFzIHByb2Nlc3NlZCBldmVyeXRoaW5nIHdlJ3ZlIGRvbmUgaW4gdGhpc1xuICAgIC8vIHJvdW5kLCBtYXJrIGFsbCB0aGUgd3JpdGVzIHdoaWNoIGV4aXN0ZWQgYmVmb3JlIHRoaXMgY2FsbCBhc1xuICAgIC8vIGNvbW1taXR0ZWQuIChJZiBuZXcgd3JpdGVzIGhhdmUgc2hvd24gdXAgaW4gdGhlIG1lYW50aW1lLCB0aGVyZSdsbFxuICAgIC8vIGFscmVhZHkgYmUgYW5vdGhlciBfcG9sbE1vbmdvIHRhc2sgc2NoZWR1bGVkLilcbiAgICBzZWxmLl9tdWx0aXBsZXhlci5vbkZsdXNoKGZ1bmN0aW9uICgpIHtcbiAgICAgIF8uZWFjaCh3cml0ZXNGb3JDeWNsZSwgZnVuY3Rpb24gKHcpIHtcbiAgICAgICAgdy5jb21taXR0ZWQoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuXG4gIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5fc3RvcHBlZCA9IHRydWU7XG4gICAgXy5lYWNoKHNlbGYuX3N0b3BDYWxsYmFja3MsIGZ1bmN0aW9uIChjKSB7IGMoKTsgfSk7XG4gICAgLy8gUmVsZWFzZSBhbnkgd3JpdGUgZmVuY2VzIHRoYXQgYXJlIHdhaXRpbmcgb24gdXMuXG4gICAgXy5lYWNoKHNlbGYuX3BlbmRpbmdXcml0ZXMsIGZ1bmN0aW9uICh3KSB7XG4gICAgICB3LmNvbW1pdHRlZCgpO1xuICAgIH0pO1xuICAgIFBhY2thZ2UuZmFjdHMgJiYgUGFja2FnZS5mYWN0cy5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgICAgXCJtb25nby1saXZlZGF0YVwiLCBcIm9ic2VydmUtZHJpdmVycy1wb2xsaW5nXCIsIC0xKTtcbiAgfVxufSk7XG4iLCJ2YXIgRnV0dXJlID0gTnBtLnJlcXVpcmUoJ2ZpYmVycy9mdXR1cmUnKTtcblxudmFyIFBIQVNFID0ge1xuICBRVUVSWUlORzogXCJRVUVSWUlOR1wiLFxuICBGRVRDSElORzogXCJGRVRDSElOR1wiLFxuICBTVEVBRFk6IFwiU1RFQURZXCJcbn07XG5cbi8vIEV4Y2VwdGlvbiB0aHJvd24gYnkgX25lZWRUb1BvbGxRdWVyeSB3aGljaCB1bnJvbGxzIHRoZSBzdGFjayB1cCB0byB0aGVcbi8vIGVuY2xvc2luZyBjYWxsIHRvIGZpbmlzaElmTmVlZFRvUG9sbFF1ZXJ5LlxudmFyIFN3aXRjaGVkVG9RdWVyeSA9IGZ1bmN0aW9uICgpIHt9O1xudmFyIGZpbmlzaElmTmVlZFRvUG9sbFF1ZXJ5ID0gZnVuY3Rpb24gKGYpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICB0cnkge1xuICAgICAgZi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmICghKGUgaW5zdGFuY2VvZiBTd2l0Y2hlZFRvUXVlcnkpKVxuICAgICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfTtcbn07XG5cbnZhciBjdXJyZW50SWQgPSAwO1xuXG4vLyBPcGxvZ09ic2VydmVEcml2ZXIgaXMgYW4gYWx0ZXJuYXRpdmUgdG8gUG9sbGluZ09ic2VydmVEcml2ZXIgd2hpY2ggZm9sbG93c1xuLy8gdGhlIE1vbmdvIG9wZXJhdGlvbiBsb2cgaW5zdGVhZCBvZiBqdXN0IHJlLXBvbGxpbmcgdGhlIHF1ZXJ5LiBJdCBvYmV5cyB0aGVcbi8vIHNhbWUgc2ltcGxlIGludGVyZmFjZTogY29uc3RydWN0aW5nIGl0IHN0YXJ0cyBzZW5kaW5nIG9ic2VydmVDaGFuZ2VzXG4vLyBjYWxsYmFja3MgKGFuZCBhIHJlYWR5KCkgaW52b2NhdGlvbikgdG8gdGhlIE9ic2VydmVNdWx0aXBsZXhlciwgYW5kIHlvdSBzdG9wXG4vLyBpdCBieSBjYWxsaW5nIHRoZSBzdG9wKCkgbWV0aG9kLlxuT3Bsb2dPYnNlcnZlRHJpdmVyID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBzZWxmLl91c2VzT3Bsb2cgPSB0cnVlOyAgLy8gdGVzdHMgbG9vayBhdCB0aGlzXG5cbiAgc2VsZi5faWQgPSBjdXJyZW50SWQ7XG4gIGN1cnJlbnRJZCsrO1xuXG4gIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uID0gb3B0aW9ucy5jdXJzb3JEZXNjcmlwdGlvbjtcbiAgc2VsZi5fbW9uZ29IYW5kbGUgPSBvcHRpb25zLm1vbmdvSGFuZGxlO1xuICBzZWxmLl9tdWx0aXBsZXhlciA9IG9wdGlvbnMubXVsdGlwbGV4ZXI7XG5cbiAgaWYgKG9wdGlvbnMub3JkZXJlZCkge1xuICAgIHRocm93IEVycm9yKFwiT3Bsb2dPYnNlcnZlRHJpdmVyIG9ubHkgc3VwcG9ydHMgdW5vcmRlcmVkIG9ic2VydmVDaGFuZ2VzXCIpO1xuICB9XG5cbiAgdmFyIHNvcnRlciA9IG9wdGlvbnMuc29ydGVyO1xuICAvLyBXZSBkb24ndCBzdXBwb3J0ICRuZWFyIGFuZCBvdGhlciBnZW8tcXVlcmllcyBzbyBpdCdzIE9LIHRvIGluaXRpYWxpemUgdGhlXG4gIC8vIGNvbXBhcmF0b3Igb25seSBvbmNlIGluIHRoZSBjb25zdHJ1Y3Rvci5cbiAgdmFyIGNvbXBhcmF0b3IgPSBzb3J0ZXIgJiYgc29ydGVyLmdldENvbXBhcmF0b3IoKTtcblxuICBpZiAob3B0aW9ucy5jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLmxpbWl0KSB7XG4gICAgLy8gVGhlcmUgYXJlIHNldmVyYWwgcHJvcGVydGllcyBvcmRlcmVkIGRyaXZlciBpbXBsZW1lbnRzOlxuICAgIC8vIC0gX2xpbWl0IGlzIGEgcG9zaXRpdmUgbnVtYmVyXG4gICAgLy8gLSBfY29tcGFyYXRvciBpcyBhIGZ1bmN0aW9uLWNvbXBhcmF0b3IgYnkgd2hpY2ggdGhlIHF1ZXJ5IGlzIG9yZGVyZWRcbiAgICAvLyAtIF91bnB1Ymxpc2hlZEJ1ZmZlciBpcyBub24tbnVsbCBNaW4vTWF4IEhlYXAsXG4gICAgLy8gICAgICAgICAgICAgICAgICAgICAgdGhlIGVtcHR5IGJ1ZmZlciBpbiBTVEVBRFkgcGhhc2UgaW1wbGllcyB0aGF0IHRoZVxuICAgIC8vICAgICAgICAgICAgICAgICAgICAgIGV2ZXJ5dGhpbmcgdGhhdCBtYXRjaGVzIHRoZSBxdWVyaWVzIHNlbGVjdG9yIGZpdHNcbiAgICAvLyAgICAgICAgICAgICAgICAgICAgICBpbnRvIHB1Ymxpc2hlZCBzZXQuXG4gICAgLy8gLSBfcHVibGlzaGVkIC0gTWluIEhlYXAgKGFsc28gaW1wbGVtZW50cyBJZE1hcCBtZXRob2RzKVxuXG4gICAgdmFyIGhlYXBPcHRpb25zID0geyBJZE1hcDogTG9jYWxDb2xsZWN0aW9uLl9JZE1hcCB9O1xuICAgIHNlbGYuX2xpbWl0ID0gc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy5saW1pdDtcbiAgICBzZWxmLl9jb21wYXJhdG9yID0gY29tcGFyYXRvcjtcbiAgICBzZWxmLl9zb3J0ZXIgPSBzb3J0ZXI7XG4gICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIgPSBuZXcgTWluTWF4SGVhcChjb21wYXJhdG9yLCBoZWFwT3B0aW9ucyk7XG4gICAgLy8gV2UgbmVlZCBzb21ldGhpbmcgdGhhdCBjYW4gZmluZCBNYXggdmFsdWUgaW4gYWRkaXRpb24gdG8gSWRNYXAgaW50ZXJmYWNlXG4gICAgc2VsZi5fcHVibGlzaGVkID0gbmV3IE1heEhlYXAoY29tcGFyYXRvciwgaGVhcE9wdGlvbnMpO1xuICB9IGVsc2Uge1xuICAgIHNlbGYuX2xpbWl0ID0gMDtcbiAgICBzZWxmLl9jb21wYXJhdG9yID0gbnVsbDtcbiAgICBzZWxmLl9zb3J0ZXIgPSBudWxsO1xuICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyID0gbnVsbDtcbiAgICBzZWxmLl9wdWJsaXNoZWQgPSBuZXcgTG9jYWxDb2xsZWN0aW9uLl9JZE1hcDtcbiAgfVxuXG4gIC8vIEluZGljYXRlcyBpZiBpdCBpcyBzYWZlIHRvIGluc2VydCBhIG5ldyBkb2N1bWVudCBhdCB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgLy8gZm9yIHRoaXMgcXVlcnkuIGkuZS4gaXQgaXMga25vd24gdGhhdCB0aGVyZSBhcmUgbm8gZG9jdW1lbnRzIG1hdGNoaW5nIHRoZVxuICAvLyBzZWxlY3RvciB0aG9zZSBhcmUgbm90IGluIHB1Ymxpc2hlZCBvciBidWZmZXIuXG4gIHNlbGYuX3NhZmVBcHBlbmRUb0J1ZmZlciA9IGZhbHNlO1xuXG4gIHNlbGYuX3N0b3BwZWQgPSBmYWxzZTtcbiAgc2VsZi5fc3RvcEhhbmRsZXMgPSBbXTtcblxuICBQYWNrYWdlLmZhY3RzICYmIFBhY2thZ2UuZmFjdHMuRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICBcIm1vbmdvLWxpdmVkYXRhXCIsIFwib2JzZXJ2ZS1kcml2ZXJzLW9wbG9nXCIsIDEpO1xuXG4gIHNlbGYuX3JlZ2lzdGVyUGhhc2VDaGFuZ2UoUEhBU0UuUVVFUllJTkcpO1xuXG4gIHNlbGYuX21hdGNoZXIgPSBvcHRpb25zLm1hdGNoZXI7XG4gIHZhciBwcm9qZWN0aW9uID0gc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy5maWVsZHMgfHwge307XG4gIHNlbGYuX3Byb2plY3Rpb25GbiA9IExvY2FsQ29sbGVjdGlvbi5fY29tcGlsZVByb2plY3Rpb24ocHJvamVjdGlvbik7XG4gIC8vIFByb2plY3Rpb24gZnVuY3Rpb24sIHJlc3VsdCBvZiBjb21iaW5pbmcgaW1wb3J0YW50IGZpZWxkcyBmb3Igc2VsZWN0b3IgYW5kXG4gIC8vIGV4aXN0aW5nIGZpZWxkcyBwcm9qZWN0aW9uXG4gIHNlbGYuX3NoYXJlZFByb2plY3Rpb24gPSBzZWxmLl9tYXRjaGVyLmNvbWJpbmVJbnRvUHJvamVjdGlvbihwcm9qZWN0aW9uKTtcbiAgaWYgKHNvcnRlcilcbiAgICBzZWxmLl9zaGFyZWRQcm9qZWN0aW9uID0gc29ydGVyLmNvbWJpbmVJbnRvUHJvamVjdGlvbihzZWxmLl9zaGFyZWRQcm9qZWN0aW9uKTtcbiAgc2VsZi5fc2hhcmVkUHJvamVjdGlvbkZuID0gTG9jYWxDb2xsZWN0aW9uLl9jb21waWxlUHJvamVjdGlvbihcbiAgICBzZWxmLl9zaGFyZWRQcm9qZWN0aW9uKTtcblxuICBzZWxmLl9uZWVkVG9GZXRjaCA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuICBzZWxmLl9jdXJyZW50bHlGZXRjaGluZyA9IG51bGw7XG4gIHNlbGYuX2ZldGNoR2VuZXJhdGlvbiA9IDA7XG5cbiAgc2VsZi5fcmVxdWVyeVdoZW5Eb25lVGhpc1F1ZXJ5ID0gZmFsc2U7XG4gIHNlbGYuX3dyaXRlc1RvQ29tbWl0V2hlbldlUmVhY2hTdGVhZHkgPSBbXTtcblxuICAvLyBJZiB0aGUgb3Bsb2cgaGFuZGxlIHRlbGxzIHVzIHRoYXQgaXQgc2tpcHBlZCBzb21lIGVudHJpZXMgKGJlY2F1c2UgaXQgZ290XG4gIC8vIGJlaGluZCwgc2F5KSwgcmUtcG9sbC5cbiAgc2VsZi5fc3RvcEhhbmRsZXMucHVzaChzZWxmLl9tb25nb0hhbmRsZS5fb3Bsb2dIYW5kbGUub25Ta2lwcGVkRW50cmllcyhcbiAgICBmaW5pc2hJZk5lZWRUb1BvbGxRdWVyeShmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9uZWVkVG9Qb2xsUXVlcnkoKTtcbiAgICB9KVxuICApKTtcblxuICBmb3JFYWNoVHJpZ2dlcihzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbiwgZnVuY3Rpb24gKHRyaWdnZXIpIHtcbiAgICBzZWxmLl9zdG9wSGFuZGxlcy5wdXNoKHNlbGYuX21vbmdvSGFuZGxlLl9vcGxvZ0hhbmRsZS5vbk9wbG9nRW50cnkoXG4gICAgICB0cmlnZ2VyLCBmdW5jdGlvbiAobm90aWZpY2F0aW9uKSB7XG4gICAgICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZpbmlzaElmTmVlZFRvUG9sbFF1ZXJ5KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICB2YXIgb3AgPSBub3RpZmljYXRpb24ub3A7XG4gICAgICAgICAgaWYgKG5vdGlmaWNhdGlvbi5kcm9wQ29sbGVjdGlvbiB8fCBub3RpZmljYXRpb24uZHJvcERhdGFiYXNlKSB7XG4gICAgICAgICAgICAvLyBOb3RlOiB0aGlzIGNhbGwgaXMgbm90IGFsbG93ZWQgdG8gYmxvY2sgb24gYW55dGhpbmcgKGVzcGVjaWFsbHlcbiAgICAgICAgICAgIC8vIG9uIHdhaXRpbmcgZm9yIG9wbG9nIGVudHJpZXMgdG8gY2F0Y2ggdXApIGJlY2F1c2UgdGhhdCB3aWxsIGJsb2NrXG4gICAgICAgICAgICAvLyBvbk9wbG9nRW50cnkhXG4gICAgICAgICAgICBzZWxmLl9uZWVkVG9Qb2xsUXVlcnkoKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gQWxsIG90aGVyIG9wZXJhdG9ycyBzaG91bGQgYmUgaGFuZGxlZCBkZXBlbmRpbmcgb24gcGhhc2VcbiAgICAgICAgICAgIGlmIChzZWxmLl9waGFzZSA9PT0gUEhBU0UuUVVFUllJTkcpIHtcbiAgICAgICAgICAgICAgc2VsZi5faGFuZGxlT3Bsb2dFbnRyeVF1ZXJ5aW5nKG9wKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHNlbGYuX2hhbmRsZU9wbG9nRW50cnlTdGVhZHlPckZldGNoaW5nKG9wKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pKTtcbiAgICAgIH1cbiAgICApKTtcbiAgfSk7XG5cbiAgLy8gWFhYIG9yZGVyaW5nIHcuci50LiBldmVyeXRoaW5nIGVsc2U/XG4gIHNlbGYuX3N0b3BIYW5kbGVzLnB1c2gobGlzdGVuQWxsKFxuICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLCBmdW5jdGlvbiAobm90aWZpY2F0aW9uKSB7XG4gICAgICAvLyBJZiB3ZSdyZSBub3QgaW4gYSBwcmUtZmlyZSB3cml0ZSBmZW5jZSwgd2UgZG9uJ3QgaGF2ZSB0byBkbyBhbnl0aGluZy5cbiAgICAgIHZhciBmZW5jZSA9IEREUFNlcnZlci5fQ3VycmVudFdyaXRlRmVuY2UuZ2V0KCk7XG4gICAgICBpZiAoIWZlbmNlIHx8IGZlbmNlLmZpcmVkKVxuICAgICAgICByZXR1cm47XG5cbiAgICAgIGlmIChmZW5jZS5fb3Bsb2dPYnNlcnZlRHJpdmVycykge1xuICAgICAgICBmZW5jZS5fb3Bsb2dPYnNlcnZlRHJpdmVyc1tzZWxmLl9pZF0gPSBzZWxmO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGZlbmNlLl9vcGxvZ09ic2VydmVEcml2ZXJzID0ge307XG4gICAgICBmZW5jZS5fb3Bsb2dPYnNlcnZlRHJpdmVyc1tzZWxmLl9pZF0gPSBzZWxmO1xuXG4gICAgICBmZW5jZS5vbkJlZm9yZUZpcmUoZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgZHJpdmVycyA9IGZlbmNlLl9vcGxvZ09ic2VydmVEcml2ZXJzO1xuICAgICAgICBkZWxldGUgZmVuY2UuX29wbG9nT2JzZXJ2ZURyaXZlcnM7XG5cbiAgICAgICAgLy8gVGhpcyBmZW5jZSBjYW5ub3QgZmlyZSB1bnRpbCB3ZSd2ZSBjYXVnaHQgdXAgdG8gXCJ0aGlzIHBvaW50XCIgaW4gdGhlXG4gICAgICAgIC8vIG9wbG9nLCBhbmQgYWxsIG9ic2VydmVycyBtYWRlIGl0IGJhY2sgdG8gdGhlIHN0ZWFkeSBzdGF0ZS5cbiAgICAgICAgc2VsZi5fbW9uZ29IYW5kbGUuX29wbG9nSGFuZGxlLndhaXRVbnRpbENhdWdodFVwKCk7XG5cbiAgICAgICAgXy5lYWNoKGRyaXZlcnMsIGZ1bmN0aW9uIChkcml2ZXIpIHtcbiAgICAgICAgICBpZiAoZHJpdmVyLl9zdG9wcGVkKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgICAgdmFyIHdyaXRlID0gZmVuY2UuYmVnaW5Xcml0ZSgpO1xuICAgICAgICAgIGlmIChkcml2ZXIuX3BoYXNlID09PSBQSEFTRS5TVEVBRFkpIHtcbiAgICAgICAgICAgIC8vIE1ha2Ugc3VyZSB0aGF0IGFsbCBvZiB0aGUgY2FsbGJhY2tzIGhhdmUgbWFkZSBpdCB0aHJvdWdoIHRoZVxuICAgICAgICAgICAgLy8gbXVsdGlwbGV4ZXIgYW5kIGJlZW4gZGVsaXZlcmVkIHRvIE9ic2VydmVIYW5kbGVzIGJlZm9yZSBjb21taXR0aW5nXG4gICAgICAgICAgICAvLyB3cml0ZXMuXG4gICAgICAgICAgICBkcml2ZXIuX211bHRpcGxleGVyLm9uRmx1c2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICB3cml0ZS5jb21taXR0ZWQoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkcml2ZXIuX3dyaXRlc1RvQ29tbWl0V2hlbldlUmVhY2hTdGVhZHkucHVzaCh3cml0ZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgKSk7XG5cbiAgLy8gV2hlbiBNb25nbyBmYWlscyBvdmVyLCB3ZSBuZWVkIHRvIHJlcG9sbCB0aGUgcXVlcnksIGluIGNhc2Ugd2UgcHJvY2Vzc2VkIGFuXG4gIC8vIG9wbG9nIGVudHJ5IHRoYXQgZ290IHJvbGxlZCBiYWNrLlxuICBzZWxmLl9zdG9wSGFuZGxlcy5wdXNoKHNlbGYuX21vbmdvSGFuZGxlLl9vbkZhaWxvdmVyKGZpbmlzaElmTmVlZFRvUG9sbFF1ZXJ5KFxuICAgIGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX25lZWRUb1BvbGxRdWVyeSgpO1xuICAgIH0pKSk7XG5cbiAgLy8gR2l2ZSBfb2JzZXJ2ZUNoYW5nZXMgYSBjaGFuY2UgdG8gYWRkIHRoZSBuZXcgT2JzZXJ2ZUhhbmRsZSB0byBvdXJcbiAgLy8gbXVsdGlwbGV4ZXIsIHNvIHRoYXQgdGhlIGFkZGVkIGNhbGxzIGdldCBzdHJlYW1lZC5cbiAgTWV0ZW9yLmRlZmVyKGZpbmlzaElmTmVlZFRvUG9sbFF1ZXJ5KGZ1bmN0aW9uICgpIHtcbiAgICBzZWxmLl9ydW5Jbml0aWFsUXVlcnkoKTtcbiAgfSkpO1xufTtcblxuXy5leHRlbmQoT3Bsb2dPYnNlcnZlRHJpdmVyLnByb3RvdHlwZSwge1xuICBfYWRkUHVibGlzaGVkOiBmdW5jdGlvbiAoaWQsIGRvYykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgZmllbGRzID0gXy5jbG9uZShkb2MpO1xuICAgICAgZGVsZXRlIGZpZWxkcy5faWQ7XG4gICAgICBzZWxmLl9wdWJsaXNoZWQuc2V0KGlkLCBzZWxmLl9zaGFyZWRQcm9qZWN0aW9uRm4oZG9jKSk7XG4gICAgICBzZWxmLl9tdWx0aXBsZXhlci5hZGRlZChpZCwgc2VsZi5fcHJvamVjdGlvbkZuKGZpZWxkcykpO1xuXG4gICAgICAvLyBBZnRlciBhZGRpbmcgdGhpcyBkb2N1bWVudCwgdGhlIHB1Ymxpc2hlZCBzZXQgbWlnaHQgYmUgb3ZlcmZsb3dlZFxuICAgICAgLy8gKGV4Y2VlZGluZyBjYXBhY2l0eSBzcGVjaWZpZWQgYnkgbGltaXQpLiBJZiBzbywgcHVzaCB0aGUgbWF4aW11bVxuICAgICAgLy8gZWxlbWVudCB0byB0aGUgYnVmZmVyLCB3ZSBtaWdodCB3YW50IHRvIHNhdmUgaXQgaW4gbWVtb3J5IHRvIHJlZHVjZSB0aGVcbiAgICAgIC8vIGFtb3VudCBvZiBNb25nbyBsb29rdXBzIGluIHRoZSBmdXR1cmUuXG4gICAgICBpZiAoc2VsZi5fbGltaXQgJiYgc2VsZi5fcHVibGlzaGVkLnNpemUoKSA+IHNlbGYuX2xpbWl0KSB7XG4gICAgICAgIC8vIFhYWCBpbiB0aGVvcnkgdGhlIHNpemUgb2YgcHVibGlzaGVkIGlzIG5vIG1vcmUgdGhhbiBsaW1pdCsxXG4gICAgICAgIGlmIChzZWxmLl9wdWJsaXNoZWQuc2l6ZSgpICE9PSBzZWxmLl9saW1pdCArIDEpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBZnRlciBhZGRpbmcgdG8gcHVibGlzaGVkLCBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgICAgIChzZWxmLl9wdWJsaXNoZWQuc2l6ZSgpIC0gc2VsZi5fbGltaXQpICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgXCIgZG9jdW1lbnRzIGFyZSBvdmVyZmxvd2luZyB0aGUgc2V0XCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG92ZXJmbG93aW5nRG9jSWQgPSBzZWxmLl9wdWJsaXNoZWQubWF4RWxlbWVudElkKCk7XG4gICAgICAgIHZhciBvdmVyZmxvd2luZ0RvYyA9IHNlbGYuX3B1Ymxpc2hlZC5nZXQob3ZlcmZsb3dpbmdEb2NJZCk7XG5cbiAgICAgICAgaWYgKEVKU09OLmVxdWFscyhvdmVyZmxvd2luZ0RvY0lkLCBpZCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgZG9jdW1lbnQganVzdCBhZGRlZCBpcyBvdmVyZmxvd2luZyB0aGUgcHVibGlzaGVkIHNldFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlbGYuX3B1Ymxpc2hlZC5yZW1vdmUob3ZlcmZsb3dpbmdEb2NJZCk7XG4gICAgICAgIHNlbGYuX211bHRpcGxleGVyLnJlbW92ZWQob3ZlcmZsb3dpbmdEb2NJZCk7XG4gICAgICAgIHNlbGYuX2FkZEJ1ZmZlcmVkKG92ZXJmbG93aW5nRG9jSWQsIG92ZXJmbG93aW5nRG9jKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcbiAgX3JlbW92ZVB1Ymxpc2hlZDogZnVuY3Rpb24gKGlkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX3B1Ymxpc2hlZC5yZW1vdmUoaWQpO1xuICAgICAgc2VsZi5fbXVsdGlwbGV4ZXIucmVtb3ZlZChpZCk7XG4gICAgICBpZiAoISBzZWxmLl9saW1pdCB8fCBzZWxmLl9wdWJsaXNoZWQuc2l6ZSgpID09PSBzZWxmLl9saW1pdClcbiAgICAgICAgcmV0dXJuO1xuXG4gICAgICBpZiAoc2VsZi5fcHVibGlzaGVkLnNpemUoKSA+IHNlbGYuX2xpbWl0KVxuICAgICAgICB0aHJvdyBFcnJvcihcInNlbGYuX3B1Ymxpc2hlZCBnb3QgdG9vIGJpZ1wiKTtcblxuICAgICAgLy8gT0ssIHdlIGFyZSBwdWJsaXNoaW5nIGxlc3MgdGhhbiB0aGUgbGltaXQuIE1heWJlIHdlIHNob3VsZCBsb29rIGluIHRoZVxuICAgICAgLy8gYnVmZmVyIHRvIGZpbmQgdGhlIG5leHQgZWxlbWVudCBwYXN0IHdoYXQgd2Ugd2VyZSBwdWJsaXNoaW5nIGJlZm9yZS5cblxuICAgICAgaWYgKCFzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5lbXB0eSgpKSB7XG4gICAgICAgIC8vIFRoZXJlJ3Mgc29tZXRoaW5nIGluIHRoZSBidWZmZXI7IG1vdmUgdGhlIGZpcnN0IHRoaW5nIGluIGl0IHRvXG4gICAgICAgIC8vIF9wdWJsaXNoZWQuXG4gICAgICAgIHZhciBuZXdEb2NJZCA9IHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLm1pbkVsZW1lbnRJZCgpO1xuICAgICAgICB2YXIgbmV3RG9jID0gc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuZ2V0KG5ld0RvY0lkKTtcbiAgICAgICAgc2VsZi5fcmVtb3ZlQnVmZmVyZWQobmV3RG9jSWQpO1xuICAgICAgICBzZWxmLl9hZGRQdWJsaXNoZWQobmV3RG9jSWQsIG5ld0RvYyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gVGhlcmUncyBub3RoaW5nIGluIHRoZSBidWZmZXIuICBUaGlzIGNvdWxkIG1lYW4gb25lIG9mIGEgZmV3IHRoaW5ncy5cblxuICAgICAgLy8gKGEpIFdlIGNvdWxkIGJlIGluIHRoZSBtaWRkbGUgb2YgcmUtcnVubmluZyB0aGUgcXVlcnkgKHNwZWNpZmljYWxseSwgd2VcbiAgICAgIC8vIGNvdWxkIGJlIGluIF9wdWJsaXNoTmV3UmVzdWx0cykuIEluIHRoYXQgY2FzZSwgX3VucHVibGlzaGVkQnVmZmVyIGlzXG4gICAgICAvLyBlbXB0eSBiZWNhdXNlIHdlIGNsZWFyIGl0IGF0IHRoZSBiZWdpbm5pbmcgb2YgX3B1Ymxpc2hOZXdSZXN1bHRzLiBJblxuICAgICAgLy8gdGhpcyBjYXNlLCBvdXIgY2FsbGVyIGFscmVhZHkga25vd3MgdGhlIGVudGlyZSBhbnN3ZXIgdG8gdGhlIHF1ZXJ5IGFuZFxuICAgICAgLy8gd2UgZG9uJ3QgbmVlZCB0byBkbyBhbnl0aGluZyBmYW5jeSBoZXJlLiAgSnVzdCByZXR1cm4uXG4gICAgICBpZiAoc2VsZi5fcGhhc2UgPT09IFBIQVNFLlFVRVJZSU5HKVxuICAgICAgICByZXR1cm47XG5cbiAgICAgIC8vIChiKSBXZSdyZSBwcmV0dHkgY29uZmlkZW50IHRoYXQgdGhlIHVuaW9uIG9mIF9wdWJsaXNoZWQgYW5kXG4gICAgICAvLyBfdW5wdWJsaXNoZWRCdWZmZXIgY29udGFpbiBhbGwgZG9jdW1lbnRzIHRoYXQgbWF0Y2ggc2VsZWN0b3IuIEJlY2F1c2VcbiAgICAgIC8vIF91bnB1Ymxpc2hlZEJ1ZmZlciBpcyBlbXB0eSwgdGhhdCBtZWFucyB3ZSdyZSBjb25maWRlbnQgdGhhdCBfcHVibGlzaGVkXG4gICAgICAvLyBjb250YWlucyBhbGwgZG9jdW1lbnRzIHRoYXQgbWF0Y2ggc2VsZWN0b3IuIFNvIHdlIGhhdmUgbm90aGluZyB0byBkby5cbiAgICAgIGlmIChzZWxmLl9zYWZlQXBwZW5kVG9CdWZmZXIpXG4gICAgICAgIHJldHVybjtcblxuICAgICAgLy8gKGMpIE1heWJlIHRoZXJlIGFyZSBvdGhlciBkb2N1bWVudHMgb3V0IHRoZXJlIHRoYXQgc2hvdWxkIGJlIGluIG91clxuICAgICAgLy8gYnVmZmVyLiBCdXQgaW4gdGhhdCBjYXNlLCB3aGVuIHdlIGVtcHRpZWQgX3VucHVibGlzaGVkQnVmZmVyIGluXG4gICAgICAvLyBfcmVtb3ZlQnVmZmVyZWQsIHdlIHNob3VsZCBoYXZlIGNhbGxlZCBfbmVlZFRvUG9sbFF1ZXJ5LCB3aGljaCB3aWxsXG4gICAgICAvLyBlaXRoZXIgcHV0IHNvbWV0aGluZyBpbiBfdW5wdWJsaXNoZWRCdWZmZXIgb3Igc2V0IF9zYWZlQXBwZW5kVG9CdWZmZXJcbiAgICAgIC8vIChvciBib3RoKSwgYW5kIGl0IHdpbGwgcHV0IHVzIGluIFFVRVJZSU5HIGZvciB0aGF0IHdob2xlIHRpbWUuIFNvIGluXG4gICAgICAvLyBmYWN0LCB3ZSBzaG91bGRuJ3QgYmUgYWJsZSB0byBnZXQgaGVyZS5cblxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQnVmZmVyIGluZXhwbGljYWJseSBlbXB0eVwiKTtcbiAgICB9KTtcbiAgfSxcbiAgX2NoYW5nZVB1Ymxpc2hlZDogZnVuY3Rpb24gKGlkLCBvbGREb2MsIG5ld0RvYykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9wdWJsaXNoZWQuc2V0KGlkLCBzZWxmLl9zaGFyZWRQcm9qZWN0aW9uRm4obmV3RG9jKSk7XG4gICAgICB2YXIgcHJvamVjdGVkTmV3ID0gc2VsZi5fcHJvamVjdGlvbkZuKG5ld0RvYyk7XG4gICAgICB2YXIgcHJvamVjdGVkT2xkID0gc2VsZi5fcHJvamVjdGlvbkZuKG9sZERvYyk7XG4gICAgICB2YXIgY2hhbmdlZCA9IERpZmZTZXF1ZW5jZS5tYWtlQ2hhbmdlZEZpZWxkcyhcbiAgICAgICAgcHJvamVjdGVkTmV3LCBwcm9qZWN0ZWRPbGQpO1xuICAgICAgaWYgKCFfLmlzRW1wdHkoY2hhbmdlZCkpXG4gICAgICAgIHNlbGYuX211bHRpcGxleGVyLmNoYW5nZWQoaWQsIGNoYW5nZWQpO1xuICAgIH0pO1xuICB9LFxuICBfYWRkQnVmZmVyZWQ6IGZ1bmN0aW9uIChpZCwgZG9jKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNldChpZCwgc2VsZi5fc2hhcmVkUHJvamVjdGlvbkZuKGRvYykpO1xuXG4gICAgICAvLyBJZiBzb21ldGhpbmcgaXMgb3ZlcmZsb3dpbmcgdGhlIGJ1ZmZlciwgd2UganVzdCByZW1vdmUgaXQgZnJvbSBjYWNoZVxuICAgICAgaWYgKHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSA+IHNlbGYuX2xpbWl0KSB7XG4gICAgICAgIHZhciBtYXhCdWZmZXJlZElkID0gc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIubWF4RWxlbWVudElkKCk7XG5cbiAgICAgICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIucmVtb3ZlKG1heEJ1ZmZlcmVkSWQpO1xuXG4gICAgICAgIC8vIFNpbmNlIHNvbWV0aGluZyBtYXRjaGluZyBpcyByZW1vdmVkIGZyb20gY2FjaGUgKGJvdGggcHVibGlzaGVkIHNldCBhbmRcbiAgICAgICAgLy8gYnVmZmVyKSwgc2V0IGZsYWcgdG8gZmFsc2VcbiAgICAgICAgc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyID0gZmFsc2U7XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG4gIC8vIElzIGNhbGxlZCBlaXRoZXIgdG8gcmVtb3ZlIHRoZSBkb2MgY29tcGxldGVseSBmcm9tIG1hdGNoaW5nIHNldCBvciB0byBtb3ZlXG4gIC8vIGl0IHRvIHRoZSBwdWJsaXNoZWQgc2V0IGxhdGVyLlxuICBfcmVtb3ZlQnVmZmVyZWQ6IGZ1bmN0aW9uIChpZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5yZW1vdmUoaWQpO1xuICAgICAgLy8gVG8ga2VlcCB0aGUgY29udHJhY3QgXCJidWZmZXIgaXMgbmV2ZXIgZW1wdHkgaW4gU1RFQURZIHBoYXNlIHVubGVzcyB0aGVcbiAgICAgIC8vIGV2ZXJ5dGhpbmcgbWF0Y2hpbmcgZml0cyBpbnRvIHB1Ymxpc2hlZFwiIHRydWUsIHdlIHBvbGwgZXZlcnl0aGluZyBhc1xuICAgICAgLy8gc29vbiBhcyB3ZSBzZWUgdGhlIGJ1ZmZlciBiZWNvbWluZyBlbXB0eS5cbiAgICAgIGlmICghIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSAmJiAhIHNlbGYuX3NhZmVBcHBlbmRUb0J1ZmZlcilcbiAgICAgICAgc2VsZi5fbmVlZFRvUG9sbFF1ZXJ5KCk7XG4gICAgfSk7XG4gIH0sXG4gIC8vIENhbGxlZCB3aGVuIGEgZG9jdW1lbnQgaGFzIGpvaW5lZCB0aGUgXCJNYXRjaGluZ1wiIHJlc3VsdHMgc2V0LlxuICAvLyBUYWtlcyByZXNwb25zaWJpbGl0eSBvZiBrZWVwaW5nIF91bnB1Ymxpc2hlZEJ1ZmZlciBpbiBzeW5jIHdpdGggX3B1Ymxpc2hlZFxuICAvLyBhbmQgdGhlIGVmZmVjdCBvZiBsaW1pdCBlbmZvcmNlZC5cbiAgX2FkZE1hdGNoaW5nOiBmdW5jdGlvbiAoZG9jKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHZhciBpZCA9IGRvYy5faWQ7XG4gICAgICBpZiAoc2VsZi5fcHVibGlzaGVkLmhhcyhpZCkpXG4gICAgICAgIHRocm93IEVycm9yKFwidHJpZWQgdG8gYWRkIHNvbWV0aGluZyBhbHJlYWR5IHB1Ymxpc2hlZCBcIiArIGlkKTtcbiAgICAgIGlmIChzZWxmLl9saW1pdCAmJiBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5oYXMoaWQpKVxuICAgICAgICB0aHJvdyBFcnJvcihcInRyaWVkIHRvIGFkZCBzb21ldGhpbmcgYWxyZWFkeSBleGlzdGVkIGluIGJ1ZmZlciBcIiArIGlkKTtcblxuICAgICAgdmFyIGxpbWl0ID0gc2VsZi5fbGltaXQ7XG4gICAgICB2YXIgY29tcGFyYXRvciA9IHNlbGYuX2NvbXBhcmF0b3I7XG4gICAgICB2YXIgbWF4UHVibGlzaGVkID0gKGxpbWl0ICYmIHNlbGYuX3B1Ymxpc2hlZC5zaXplKCkgPiAwKSA/XG4gICAgICAgIHNlbGYuX3B1Ymxpc2hlZC5nZXQoc2VsZi5fcHVibGlzaGVkLm1heEVsZW1lbnRJZCgpKSA6IG51bGw7XG4gICAgICB2YXIgbWF4QnVmZmVyZWQgPSAobGltaXQgJiYgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuc2l6ZSgpID4gMClcbiAgICAgICAgPyBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5nZXQoc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIubWF4RWxlbWVudElkKCkpXG4gICAgICAgIDogbnVsbDtcbiAgICAgIC8vIFRoZSBxdWVyeSBpcyB1bmxpbWl0ZWQgb3IgZGlkbid0IHB1Ymxpc2ggZW5vdWdoIGRvY3VtZW50cyB5ZXQgb3IgdGhlXG4gICAgICAvLyBuZXcgZG9jdW1lbnQgd291bGQgZml0IGludG8gcHVibGlzaGVkIHNldCBwdXNoaW5nIHRoZSBtYXhpbXVtIGVsZW1lbnRcbiAgICAgIC8vIG91dCwgdGhlbiB3ZSBuZWVkIHRvIHB1Ymxpc2ggdGhlIGRvYy5cbiAgICAgIHZhciB0b1B1Ymxpc2ggPSAhIGxpbWl0IHx8IHNlbGYuX3B1Ymxpc2hlZC5zaXplKCkgPCBsaW1pdCB8fFxuICAgICAgICBjb21wYXJhdG9yKGRvYywgbWF4UHVibGlzaGVkKSA8IDA7XG5cbiAgICAgIC8vIE90aGVyd2lzZSB3ZSBtaWdodCBuZWVkIHRvIGJ1ZmZlciBpdCAob25seSBpbiBjYXNlIG9mIGxpbWl0ZWQgcXVlcnkpLlxuICAgICAgLy8gQnVmZmVyaW5nIGlzIGFsbG93ZWQgaWYgdGhlIGJ1ZmZlciBpcyBub3QgZmlsbGVkIHVwIHlldCBhbmQgYWxsXG4gICAgICAvLyBtYXRjaGluZyBkb2NzIGFyZSBlaXRoZXIgaW4gdGhlIHB1Ymxpc2hlZCBzZXQgb3IgaW4gdGhlIGJ1ZmZlci5cbiAgICAgIHZhciBjYW5BcHBlbmRUb0J1ZmZlciA9ICF0b1B1Ymxpc2ggJiYgc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyICYmXG4gICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSA8IGxpbWl0O1xuXG4gICAgICAvLyBPciBpZiBpdCBpcyBzbWFsbCBlbm91Z2ggdG8gYmUgc2FmZWx5IGluc2VydGVkIHRvIHRoZSBtaWRkbGUgb3IgdGhlXG4gICAgICAvLyBiZWdpbm5pbmcgb2YgdGhlIGJ1ZmZlci5cbiAgICAgIHZhciBjYW5JbnNlcnRJbnRvQnVmZmVyID0gIXRvUHVibGlzaCAmJiBtYXhCdWZmZXJlZCAmJlxuICAgICAgICBjb21wYXJhdG9yKGRvYywgbWF4QnVmZmVyZWQpIDw9IDA7XG5cbiAgICAgIHZhciB0b0J1ZmZlciA9IGNhbkFwcGVuZFRvQnVmZmVyIHx8IGNhbkluc2VydEludG9CdWZmZXI7XG5cbiAgICAgIGlmICh0b1B1Ymxpc2gpIHtcbiAgICAgICAgc2VsZi5fYWRkUHVibGlzaGVkKGlkLCBkb2MpO1xuICAgICAgfSBlbHNlIGlmICh0b0J1ZmZlcikge1xuICAgICAgICBzZWxmLl9hZGRCdWZmZXJlZChpZCwgZG9jKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIGRyb3BwaW5nIGl0IGFuZCBub3Qgc2F2aW5nIHRvIHRoZSBjYWNoZVxuICAgICAgICBzZWxmLl9zYWZlQXBwZW5kVG9CdWZmZXIgPSBmYWxzZTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcbiAgLy8gQ2FsbGVkIHdoZW4gYSBkb2N1bWVudCBsZWF2ZXMgdGhlIFwiTWF0Y2hpbmdcIiByZXN1bHRzIHNldC5cbiAgLy8gVGFrZXMgcmVzcG9uc2liaWxpdHkgb2Yga2VlcGluZyBfdW5wdWJsaXNoZWRCdWZmZXIgaW4gc3luYyB3aXRoIF9wdWJsaXNoZWRcbiAgLy8gYW5kIHRoZSBlZmZlY3Qgb2YgbGltaXQgZW5mb3JjZWQuXG4gIF9yZW1vdmVNYXRjaGluZzogZnVuY3Rpb24gKGlkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmICghIHNlbGYuX3B1Ymxpc2hlZC5oYXMoaWQpICYmICEgc2VsZi5fbGltaXQpXG4gICAgICAgIHRocm93IEVycm9yKFwidHJpZWQgdG8gcmVtb3ZlIHNvbWV0aGluZyBtYXRjaGluZyBidXQgbm90IGNhY2hlZCBcIiArIGlkKTtcblxuICAgICAgaWYgKHNlbGYuX3B1Ymxpc2hlZC5oYXMoaWQpKSB7XG4gICAgICAgIHNlbGYuX3JlbW92ZVB1Ymxpc2hlZChpZCk7XG4gICAgICB9IGVsc2UgaWYgKHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmhhcyhpZCkpIHtcbiAgICAgICAgc2VsZi5fcmVtb3ZlQnVmZmVyZWQoaWQpO1xuICAgICAgfVxuICAgIH0pO1xuICB9LFxuICBfaGFuZGxlRG9jOiBmdW5jdGlvbiAoaWQsIG5ld0RvYykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgbWF0Y2hlc05vdyA9IG5ld0RvYyAmJiBzZWxmLl9tYXRjaGVyLmRvY3VtZW50TWF0Y2hlcyhuZXdEb2MpLnJlc3VsdDtcblxuICAgICAgdmFyIHB1Ymxpc2hlZEJlZm9yZSA9IHNlbGYuX3B1Ymxpc2hlZC5oYXMoaWQpO1xuICAgICAgdmFyIGJ1ZmZlcmVkQmVmb3JlID0gc2VsZi5fbGltaXQgJiYgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuaGFzKGlkKTtcbiAgICAgIHZhciBjYWNoZWRCZWZvcmUgPSBwdWJsaXNoZWRCZWZvcmUgfHwgYnVmZmVyZWRCZWZvcmU7XG5cbiAgICAgIGlmIChtYXRjaGVzTm93ICYmICFjYWNoZWRCZWZvcmUpIHtcbiAgICAgICAgc2VsZi5fYWRkTWF0Y2hpbmcobmV3RG9jKTtcbiAgICAgIH0gZWxzZSBpZiAoY2FjaGVkQmVmb3JlICYmICFtYXRjaGVzTm93KSB7XG4gICAgICAgIHNlbGYuX3JlbW92ZU1hdGNoaW5nKGlkKTtcbiAgICAgIH0gZWxzZSBpZiAoY2FjaGVkQmVmb3JlICYmIG1hdGNoZXNOb3cpIHtcbiAgICAgICAgdmFyIG9sZERvYyA9IHNlbGYuX3B1Ymxpc2hlZC5nZXQoaWQpO1xuICAgICAgICB2YXIgY29tcGFyYXRvciA9IHNlbGYuX2NvbXBhcmF0b3I7XG4gICAgICAgIHZhciBtaW5CdWZmZXJlZCA9IHNlbGYuX2xpbWl0ICYmIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSAmJlxuICAgICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmdldChzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5taW5FbGVtZW50SWQoKSk7XG4gICAgICAgIHZhciBtYXhCdWZmZXJlZDtcblxuICAgICAgICBpZiAocHVibGlzaGVkQmVmb3JlKSB7XG4gICAgICAgICAgLy8gVW5saW1pdGVkIGNhc2Ugd2hlcmUgdGhlIGRvY3VtZW50IHN0YXlzIGluIHB1Ymxpc2hlZCBvbmNlIGl0XG4gICAgICAgICAgLy8gbWF0Y2hlcyBvciB0aGUgY2FzZSB3aGVuIHdlIGRvbid0IGhhdmUgZW5vdWdoIG1hdGNoaW5nIGRvY3MgdG9cbiAgICAgICAgICAvLyBwdWJsaXNoIG9yIHRoZSBjaGFuZ2VkIGJ1dCBtYXRjaGluZyBkb2Mgd2lsbCBzdGF5IGluIHB1Ymxpc2hlZFxuICAgICAgICAgIC8vIGFueXdheXMuXG4gICAgICAgICAgLy9cbiAgICAgICAgICAvLyBYWFg6IFdlIHJlbHkgb24gdGhlIGVtcHRpbmVzcyBvZiBidWZmZXIuIEJlIHN1cmUgdG8gbWFpbnRhaW4gdGhlXG4gICAgICAgICAgLy8gZmFjdCB0aGF0IGJ1ZmZlciBjYW4ndCBiZSBlbXB0eSBpZiB0aGVyZSBhcmUgbWF0Y2hpbmcgZG9jdW1lbnRzIG5vdFxuICAgICAgICAgIC8vIHB1Ymxpc2hlZC4gTm90YWJseSwgd2UgZG9uJ3Qgd2FudCB0byBzY2hlZHVsZSByZXBvbGwgYW5kIGNvbnRpbnVlXG4gICAgICAgICAgLy8gcmVseWluZyBvbiB0aGlzIHByb3BlcnR5LlxuICAgICAgICAgIHZhciBzdGF5c0luUHVibGlzaGVkID0gISBzZWxmLl9saW1pdCB8fFxuICAgICAgICAgICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuc2l6ZSgpID09PSAwIHx8XG4gICAgICAgICAgICBjb21wYXJhdG9yKG5ld0RvYywgbWluQnVmZmVyZWQpIDw9IDA7XG5cbiAgICAgICAgICBpZiAoc3RheXNJblB1Ymxpc2hlZCkge1xuICAgICAgICAgICAgc2VsZi5fY2hhbmdlUHVibGlzaGVkKGlkLCBvbGREb2MsIG5ld0RvYyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIGFmdGVyIHRoZSBjaGFuZ2UgZG9jIGRvZXNuJ3Qgc3RheSBpbiB0aGUgcHVibGlzaGVkLCByZW1vdmUgaXRcbiAgICAgICAgICAgIHNlbGYuX3JlbW92ZVB1Ymxpc2hlZChpZCk7XG4gICAgICAgICAgICAvLyBidXQgaXQgY2FuIG1vdmUgaW50byBidWZmZXJlZCBub3csIGNoZWNrIGl0XG4gICAgICAgICAgICBtYXhCdWZmZXJlZCA9IHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmdldChcbiAgICAgICAgICAgICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIubWF4RWxlbWVudElkKCkpO1xuXG4gICAgICAgICAgICB2YXIgdG9CdWZmZXIgPSBzZWxmLl9zYWZlQXBwZW5kVG9CdWZmZXIgfHxcbiAgICAgICAgICAgICAgICAgIChtYXhCdWZmZXJlZCAmJiBjb21wYXJhdG9yKG5ld0RvYywgbWF4QnVmZmVyZWQpIDw9IDApO1xuXG4gICAgICAgICAgICBpZiAodG9CdWZmZXIpIHtcbiAgICAgICAgICAgICAgc2VsZi5fYWRkQnVmZmVyZWQoaWQsIG5ld0RvYyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAvLyBUaHJvdyBhd2F5IGZyb20gYm90aCBwdWJsaXNoZWQgc2V0IGFuZCBidWZmZXJcbiAgICAgICAgICAgICAgc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyID0gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGJ1ZmZlcmVkQmVmb3JlKSB7XG4gICAgICAgICAgb2xkRG9jID0gc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuZ2V0KGlkKTtcbiAgICAgICAgICAvLyByZW1vdmUgdGhlIG9sZCB2ZXJzaW9uIG1hbnVhbGx5IGluc3RlYWQgb2YgdXNpbmcgX3JlbW92ZUJ1ZmZlcmVkIHNvXG4gICAgICAgICAgLy8gd2UgZG9uJ3QgdHJpZ2dlciB0aGUgcXVlcnlpbmcgaW1tZWRpYXRlbHkuICBpZiB3ZSBlbmQgdGhpcyBibG9ja1xuICAgICAgICAgIC8vIHdpdGggdGhlIGJ1ZmZlciBlbXB0eSwgd2Ugd2lsbCBuZWVkIHRvIHRyaWdnZXIgdGhlIHF1ZXJ5IHBvbGxcbiAgICAgICAgICAvLyBtYW51YWxseSB0b28uXG4gICAgICAgICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIucmVtb3ZlKGlkKTtcblxuICAgICAgICAgIHZhciBtYXhQdWJsaXNoZWQgPSBzZWxmLl9wdWJsaXNoZWQuZ2V0KFxuICAgICAgICAgICAgc2VsZi5fcHVibGlzaGVkLm1heEVsZW1lbnRJZCgpKTtcbiAgICAgICAgICBtYXhCdWZmZXJlZCA9IHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSAmJlxuICAgICAgICAgICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmdldChcbiAgICAgICAgICAgICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLm1heEVsZW1lbnRJZCgpKTtcblxuICAgICAgICAgIC8vIHRoZSBidWZmZXJlZCBkb2Mgd2FzIHVwZGF0ZWQsIGl0IGNvdWxkIG1vdmUgdG8gcHVibGlzaGVkXG4gICAgICAgICAgdmFyIHRvUHVibGlzaCA9IGNvbXBhcmF0b3IobmV3RG9jLCBtYXhQdWJsaXNoZWQpIDwgMDtcblxuICAgICAgICAgIC8vIG9yIHN0YXlzIGluIGJ1ZmZlciBldmVuIGFmdGVyIHRoZSBjaGFuZ2VcbiAgICAgICAgICB2YXIgc3RheXNJbkJ1ZmZlciA9ICghIHRvUHVibGlzaCAmJiBzZWxmLl9zYWZlQXBwZW5kVG9CdWZmZXIpIHx8XG4gICAgICAgICAgICAgICAgKCF0b1B1Ymxpc2ggJiYgbWF4QnVmZmVyZWQgJiZcbiAgICAgICAgICAgICAgICAgY29tcGFyYXRvcihuZXdEb2MsIG1heEJ1ZmZlcmVkKSA8PSAwKTtcblxuICAgICAgICAgIGlmICh0b1B1Ymxpc2gpIHtcbiAgICAgICAgICAgIHNlbGYuX2FkZFB1Ymxpc2hlZChpZCwgbmV3RG9jKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHN0YXlzSW5CdWZmZXIpIHtcbiAgICAgICAgICAgIC8vIHN0YXlzIGluIGJ1ZmZlciBidXQgY2hhbmdlc1xuICAgICAgICAgICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuc2V0KGlkLCBuZXdEb2MpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBUaHJvdyBhd2F5IGZyb20gYm90aCBwdWJsaXNoZWQgc2V0IGFuZCBidWZmZXJcbiAgICAgICAgICAgIHNlbGYuX3NhZmVBcHBlbmRUb0J1ZmZlciA9IGZhbHNlO1xuICAgICAgICAgICAgLy8gTm9ybWFsbHkgdGhpcyBjaGVjayB3b3VsZCBoYXZlIGJlZW4gZG9uZSBpbiBfcmVtb3ZlQnVmZmVyZWQgYnV0XG4gICAgICAgICAgICAvLyB3ZSBkaWRuJ3QgdXNlIGl0LCBzbyB3ZSBuZWVkIHRvIGRvIGl0IG91cnNlbGYgbm93LlxuICAgICAgICAgICAgaWYgKCEgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuc2l6ZSgpKSB7XG4gICAgICAgICAgICAgIHNlbGYuX25lZWRUb1BvbGxRdWVyeSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJjYWNoZWRCZWZvcmUgaW1wbGllcyBlaXRoZXIgb2YgcHVibGlzaGVkQmVmb3JlIG9yIGJ1ZmZlcmVkQmVmb3JlIGlzIHRydWUuXCIpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG4gIF9mZXRjaE1vZGlmaWVkRG9jdW1lbnRzOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX3JlZ2lzdGVyUGhhc2VDaGFuZ2UoUEhBU0UuRkVUQ0hJTkcpO1xuICAgICAgLy8gRGVmZXIsIGJlY2F1c2Ugbm90aGluZyBjYWxsZWQgZnJvbSB0aGUgb3Bsb2cgZW50cnkgaGFuZGxlciBtYXkgeWllbGQsXG4gICAgICAvLyBidXQgZmV0Y2goKSB5aWVsZHMuXG4gICAgICBNZXRlb3IuZGVmZXIoZmluaXNoSWZOZWVkVG9Qb2xsUXVlcnkoZnVuY3Rpb24gKCkge1xuICAgICAgICB3aGlsZSAoIXNlbGYuX3N0b3BwZWQgJiYgIXNlbGYuX25lZWRUb0ZldGNoLmVtcHR5KCkpIHtcbiAgICAgICAgICBpZiAoc2VsZi5fcGhhc2UgPT09IFBIQVNFLlFVRVJZSU5HKSB7XG4gICAgICAgICAgICAvLyBXaGlsZSBmZXRjaGluZywgd2UgZGVjaWRlZCB0byBnbyBpbnRvIFFVRVJZSU5HIG1vZGUsIGFuZCB0aGVuIHdlXG4gICAgICAgICAgICAvLyBzYXcgYW5vdGhlciBvcGxvZyBlbnRyeSwgc28gX25lZWRUb0ZldGNoIGlzIG5vdCBlbXB0eS4gQnV0IHdlXG4gICAgICAgICAgICAvLyBzaG91bGRuJ3QgZmV0Y2ggdGhlc2UgZG9jdW1lbnRzIHVudGlsIEFGVEVSIHRoZSBxdWVyeSBpcyBkb25lLlxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gQmVpbmcgaW4gc3RlYWR5IHBoYXNlIGhlcmUgd291bGQgYmUgc3VycHJpc2luZy5cbiAgICAgICAgICBpZiAoc2VsZi5fcGhhc2UgIT09IFBIQVNFLkZFVENISU5HKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwicGhhc2UgaW4gZmV0Y2hNb2RpZmllZERvY3VtZW50czogXCIgKyBzZWxmLl9waGFzZSk7XG5cbiAgICAgICAgICBzZWxmLl9jdXJyZW50bHlGZXRjaGluZyA9IHNlbGYuX25lZWRUb0ZldGNoO1xuICAgICAgICAgIHZhciB0aGlzR2VuZXJhdGlvbiA9ICsrc2VsZi5fZmV0Y2hHZW5lcmF0aW9uO1xuICAgICAgICAgIHNlbGYuX25lZWRUb0ZldGNoID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gICAgICAgICAgdmFyIHdhaXRpbmcgPSAwO1xuICAgICAgICAgIHZhciBmdXQgPSBuZXcgRnV0dXJlO1xuICAgICAgICAgIC8vIFRoaXMgbG9vcCBpcyBzYWZlLCBiZWNhdXNlIF9jdXJyZW50bHlGZXRjaGluZyB3aWxsIG5vdCBiZSB1cGRhdGVkXG4gICAgICAgICAgLy8gZHVyaW5nIHRoaXMgbG9vcCAoaW4gZmFjdCwgaXQgaXMgbmV2ZXIgbXV0YXRlZCkuXG4gICAgICAgICAgc2VsZi5fY3VycmVudGx5RmV0Y2hpbmcuZm9yRWFjaChmdW5jdGlvbiAoY2FjaGVLZXksIGlkKSB7XG4gICAgICAgICAgICB3YWl0aW5nKys7XG4gICAgICAgICAgICBzZWxmLl9tb25nb0hhbmRsZS5fZG9jRmV0Y2hlci5mZXRjaChcbiAgICAgICAgICAgICAgc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24uY29sbGVjdGlvbk5hbWUsIGlkLCBjYWNoZUtleSxcbiAgICAgICAgICAgICAgZmluaXNoSWZOZWVkVG9Qb2xsUXVlcnkoZnVuY3Rpb24gKGVyciwgZG9jKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgTWV0ZW9yLl9kZWJ1ZyhcIkdvdCBleGNlcHRpb24gd2hpbGUgZmV0Y2hpbmcgZG9jdW1lbnRzOiBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgd2UgZ2V0IGFuIGVycm9yIGZyb20gdGhlIGZldGNoZXIgKGVnLCB0cm91YmxlXG4gICAgICAgICAgICAgICAgICAgIC8vIGNvbm5lY3RpbmcgdG8gTW9uZ28pLCBsZXQncyBqdXN0IGFiYW5kb24gdGhlIGZldGNoIHBoYXNlXG4gICAgICAgICAgICAgICAgICAgIC8vIGFsdG9nZXRoZXIgYW5kIGZhbGwgYmFjayB0byBwb2xsaW5nLiBJdCdzIG5vdCBsaWtlIHdlJ3JlXG4gICAgICAgICAgICAgICAgICAgIC8vIGdldHRpbmcgbGl2ZSB1cGRhdGVzIGFueXdheS5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHNlbGYuX3BoYXNlICE9PSBQSEFTRS5RVUVSWUlORykge1xuICAgICAgICAgICAgICAgICAgICAgIHNlbGYuX25lZWRUb1BvbGxRdWVyeSgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCFzZWxmLl9zdG9wcGVkICYmIHNlbGYuX3BoYXNlID09PSBQSEFTRS5GRVRDSElOR1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAmJiBzZWxmLl9mZXRjaEdlbmVyYXRpb24gPT09IHRoaXNHZW5lcmF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFdlIHJlLWNoZWNrIHRoZSBnZW5lcmF0aW9uIGluIGNhc2Ugd2UndmUgaGFkIGFuIGV4cGxpY2l0XG4gICAgICAgICAgICAgICAgICAgIC8vIF9wb2xsUXVlcnkgY2FsbCAoZWcsIGluIGFub3RoZXIgZmliZXIpIHdoaWNoIHNob3VsZFxuICAgICAgICAgICAgICAgICAgICAvLyBlZmZlY3RpdmVseSBjYW5jZWwgdGhpcyByb3VuZCBvZiBmZXRjaGVzLiAgKF9wb2xsUXVlcnlcbiAgICAgICAgICAgICAgICAgICAgLy8gaW5jcmVtZW50cyB0aGUgZ2VuZXJhdGlvbi4pXG4gICAgICAgICAgICAgICAgICAgIHNlbGYuX2hhbmRsZURvYyhpZCwgZG9jKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgICAgd2FpdGluZy0tO1xuICAgICAgICAgICAgICAgICAgLy8gQmVjYXVzZSBmZXRjaCgpIG5ldmVyIGNhbGxzIGl0cyBjYWxsYmFjayBzeW5jaHJvbm91c2x5LFxuICAgICAgICAgICAgICAgICAgLy8gdGhpcyBpcyBzYWZlIChpZSwgd2Ugd29uJ3QgY2FsbCBmdXQucmV0dXJuKCkgYmVmb3JlIHRoZVxuICAgICAgICAgICAgICAgICAgLy8gZm9yRWFjaCBpcyBkb25lKS5cbiAgICAgICAgICAgICAgICAgIGlmICh3YWl0aW5nID09PSAwKVxuICAgICAgICAgICAgICAgICAgICBmdXQucmV0dXJuKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgZnV0LndhaXQoKTtcbiAgICAgICAgICAvLyBFeGl0IG5vdyBpZiB3ZSd2ZSBoYWQgYSBfcG9sbFF1ZXJ5IGNhbGwgKGhlcmUgb3IgaW4gYW5vdGhlciBmaWJlcikuXG4gICAgICAgICAgaWYgKHNlbGYuX3BoYXNlID09PSBQSEFTRS5RVUVSWUlORylcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICBzZWxmLl9jdXJyZW50bHlGZXRjaGluZyA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgLy8gV2UncmUgZG9uZSBmZXRjaGluZywgc28gd2UgY2FuIGJlIHN0ZWFkeSwgdW5sZXNzIHdlJ3ZlIGhhZCBhXG4gICAgICAgIC8vIF9wb2xsUXVlcnkgY2FsbCAoaGVyZSBvciBpbiBhbm90aGVyIGZpYmVyKS5cbiAgICAgICAgaWYgKHNlbGYuX3BoYXNlICE9PSBQSEFTRS5RVUVSWUlORylcbiAgICAgICAgICBzZWxmLl9iZVN0ZWFkeSgpO1xuICAgICAgfSkpO1xuICAgIH0pO1xuICB9LFxuICBfYmVTdGVhZHk6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5fcmVnaXN0ZXJQaGFzZUNoYW5nZShQSEFTRS5TVEVBRFkpO1xuICAgICAgdmFyIHdyaXRlcyA9IHNlbGYuX3dyaXRlc1RvQ29tbWl0V2hlbldlUmVhY2hTdGVhZHk7XG4gICAgICBzZWxmLl93cml0ZXNUb0NvbW1pdFdoZW5XZVJlYWNoU3RlYWR5ID0gW107XG4gICAgICBzZWxmLl9tdWx0aXBsZXhlci5vbkZsdXNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgXy5lYWNoKHdyaXRlcywgZnVuY3Rpb24gKHcpIHtcbiAgICAgICAgICB3LmNvbW1pdHRlZCgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBfaGFuZGxlT3Bsb2dFbnRyeVF1ZXJ5aW5nOiBmdW5jdGlvbiAob3ApIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5fbmVlZFRvRmV0Y2guc2V0KGlkRm9yT3Aob3ApLCBvcC50cy50b1N0cmluZygpKTtcbiAgICB9KTtcbiAgfSxcbiAgX2hhbmRsZU9wbG9nRW50cnlTdGVhZHlPckZldGNoaW5nOiBmdW5jdGlvbiAob3ApIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIGlkID0gaWRGb3JPcChvcCk7XG4gICAgICAvLyBJZiB3ZSdyZSBhbHJlYWR5IGZldGNoaW5nIHRoaXMgb25lLCBvciBhYm91dCB0bywgd2UgY2FuJ3Qgb3B0aW1pemU7XG4gICAgICAvLyBtYWtlIHN1cmUgdGhhdCB3ZSBmZXRjaCBpdCBhZ2FpbiBpZiBuZWNlc3NhcnkuXG4gICAgICBpZiAoc2VsZi5fcGhhc2UgPT09IFBIQVNFLkZFVENISU5HICYmXG4gICAgICAgICAgKChzZWxmLl9jdXJyZW50bHlGZXRjaGluZyAmJiBzZWxmLl9jdXJyZW50bHlGZXRjaGluZy5oYXMoaWQpKSB8fFxuICAgICAgICAgICBzZWxmLl9uZWVkVG9GZXRjaC5oYXMoaWQpKSkge1xuICAgICAgICBzZWxmLl9uZWVkVG9GZXRjaC5zZXQoaWQsIG9wLnRzLnRvU3RyaW5nKCkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChvcC5vcCA9PT0gJ2QnKSB7XG4gICAgICAgIGlmIChzZWxmLl9wdWJsaXNoZWQuaGFzKGlkKSB8fFxuICAgICAgICAgICAgKHNlbGYuX2xpbWl0ICYmIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmhhcyhpZCkpKVxuICAgICAgICAgIHNlbGYuX3JlbW92ZU1hdGNoaW5nKGlkKTtcbiAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09ICdpJykge1xuICAgICAgICBpZiAoc2VsZi5fcHVibGlzaGVkLmhhcyhpZCkpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaW5zZXJ0IGZvdW5kIGZvciBhbHJlYWR5LWV4aXN0aW5nIElEIGluIHB1Ymxpc2hlZFwiKTtcbiAgICAgICAgaWYgKHNlbGYuX3VucHVibGlzaGVkQnVmZmVyICYmIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmhhcyhpZCkpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaW5zZXJ0IGZvdW5kIGZvciBhbHJlYWR5LWV4aXN0aW5nIElEIGluIGJ1ZmZlclwiKTtcblxuICAgICAgICAvLyBYWFggd2hhdCBpZiBzZWxlY3RvciB5aWVsZHM/ICBmb3Igbm93IGl0IGNhbid0IGJ1dCBsYXRlciBpdCBjb3VsZFxuICAgICAgICAvLyBoYXZlICR3aGVyZVxuICAgICAgICBpZiAoc2VsZi5fbWF0Y2hlci5kb2N1bWVudE1hdGNoZXMob3AubykucmVzdWx0KVxuICAgICAgICAgIHNlbGYuX2FkZE1hdGNoaW5nKG9wLm8pO1xuICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gJ3UnKSB7XG4gICAgICAgIC8vIElzIHRoaXMgYSBtb2RpZmllciAoJHNldC8kdW5zZXQsIHdoaWNoIG1heSByZXF1aXJlIHVzIHRvIHBvbGwgdGhlXG4gICAgICAgIC8vIGRhdGFiYXNlIHRvIGZpZ3VyZSBvdXQgaWYgdGhlIHdob2xlIGRvY3VtZW50IG1hdGNoZXMgdGhlIHNlbGVjdG9yKSBvclxuICAgICAgICAvLyBhIHJlcGxhY2VtZW50IChpbiB3aGljaCBjYXNlIHdlIGNhbiBqdXN0IGRpcmVjdGx5IHJlLWV2YWx1YXRlIHRoZVxuICAgICAgICAvLyBzZWxlY3Rvcik/XG4gICAgICAgIHZhciBpc1JlcGxhY2UgPSAhXy5oYXMob3AubywgJyRzZXQnKSAmJiAhXy5oYXMob3AubywgJyR1bnNldCcpO1xuICAgICAgICAvLyBJZiB0aGlzIG1vZGlmaWVyIG1vZGlmaWVzIHNvbWV0aGluZyBpbnNpZGUgYW4gRUpTT04gY3VzdG9tIHR5cGUgKGllLFxuICAgICAgICAvLyBhbnl0aGluZyB3aXRoIEVKU09OJCksIHRoZW4gd2UgY2FuJ3QgdHJ5IHRvIHVzZVxuICAgICAgICAvLyBMb2NhbENvbGxlY3Rpb24uX21vZGlmeSwgc2luY2UgdGhhdCBqdXN0IG11dGF0ZXMgdGhlIEVKU09OIGVuY29kaW5nLFxuICAgICAgICAvLyBub3QgdGhlIGFjdHVhbCBvYmplY3QuXG4gICAgICAgIHZhciBjYW5EaXJlY3RseU1vZGlmeURvYyA9XG4gICAgICAgICAgIWlzUmVwbGFjZSAmJiBtb2RpZmllckNhbkJlRGlyZWN0bHlBcHBsaWVkKG9wLm8pO1xuXG4gICAgICAgIHZhciBwdWJsaXNoZWRCZWZvcmUgPSBzZWxmLl9wdWJsaXNoZWQuaGFzKGlkKTtcbiAgICAgICAgdmFyIGJ1ZmZlcmVkQmVmb3JlID0gc2VsZi5fbGltaXQgJiYgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuaGFzKGlkKTtcblxuICAgICAgICBpZiAoaXNSZXBsYWNlKSB7XG4gICAgICAgICAgc2VsZi5faGFuZGxlRG9jKGlkLCBfLmV4dGVuZCh7X2lkOiBpZH0sIG9wLm8pKTtcbiAgICAgICAgfSBlbHNlIGlmICgocHVibGlzaGVkQmVmb3JlIHx8IGJ1ZmZlcmVkQmVmb3JlKSAmJlxuICAgICAgICAgICAgICAgICAgIGNhbkRpcmVjdGx5TW9kaWZ5RG9jKSB7XG4gICAgICAgICAgLy8gT2ggZ3JlYXQsIHdlIGFjdHVhbGx5IGtub3cgd2hhdCB0aGUgZG9jdW1lbnQgaXMsIHNvIHdlIGNhbiBhcHBseVxuICAgICAgICAgIC8vIHRoaXMgZGlyZWN0bHkuXG4gICAgICAgICAgdmFyIG5ld0RvYyA9IHNlbGYuX3B1Ymxpc2hlZC5oYXMoaWQpXG4gICAgICAgICAgICA/IHNlbGYuX3B1Ymxpc2hlZC5nZXQoaWQpIDogc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuZ2V0KGlkKTtcbiAgICAgICAgICBuZXdEb2MgPSBFSlNPTi5jbG9uZShuZXdEb2MpO1xuXG4gICAgICAgICAgbmV3RG9jLl9pZCA9IGlkO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBMb2NhbENvbGxlY3Rpb24uX21vZGlmeShuZXdEb2MsIG9wLm8pO1xuICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGlmIChlLm5hbWUgIT09IFwiTWluaW1vbmdvRXJyb3JcIilcbiAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIC8vIFdlIGRpZG4ndCB1bmRlcnN0YW5kIHRoZSBtb2RpZmllci4gIFJlLWZldGNoLlxuICAgICAgICAgICAgc2VsZi5fbmVlZFRvRmV0Y2guc2V0KGlkLCBvcC50cy50b1N0cmluZygpKTtcbiAgICAgICAgICAgIGlmIChzZWxmLl9waGFzZSA9PT0gUEhBU0UuU1RFQURZKSB7XG4gICAgICAgICAgICAgIHNlbGYuX2ZldGNoTW9kaWZpZWREb2N1bWVudHMoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgc2VsZi5faGFuZGxlRG9jKGlkLCBzZWxmLl9zaGFyZWRQcm9qZWN0aW9uRm4obmV3RG9jKSk7XG4gICAgICAgIH0gZWxzZSBpZiAoIWNhbkRpcmVjdGx5TW9kaWZ5RG9jIHx8XG4gICAgICAgICAgICAgICAgICAgc2VsZi5fbWF0Y2hlci5jYW5CZWNvbWVUcnVlQnlNb2RpZmllcihvcC5vKSB8fFxuICAgICAgICAgICAgICAgICAgIChzZWxmLl9zb3J0ZXIgJiYgc2VsZi5fc29ydGVyLmFmZmVjdGVkQnlNb2RpZmllcihvcC5vKSkpIHtcbiAgICAgICAgICBzZWxmLl9uZWVkVG9GZXRjaC5zZXQoaWQsIG9wLnRzLnRvU3RyaW5nKCkpO1xuICAgICAgICAgIGlmIChzZWxmLl9waGFzZSA9PT0gUEhBU0UuU1RFQURZKVxuICAgICAgICAgICAgc2VsZi5fZmV0Y2hNb2RpZmllZERvY3VtZW50cygpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBFcnJvcihcIlhYWCBTVVJQUklTSU5HIE9QRVJBVElPTjogXCIgKyBvcCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG4gIC8vIFlpZWxkcyFcbiAgX3J1bkluaXRpYWxRdWVyeTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIm9wbG9nIHN0b3BwZWQgc3VycHJpc2luZ2x5IGVhcmx5XCIpO1xuXG4gICAgc2VsZi5fcnVuUXVlcnkoe2luaXRpYWw6IHRydWV9KTsgIC8vIHlpZWxkc1xuXG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47ICAvLyBjYW4gaGFwcGVuIG9uIHF1ZXJ5RXJyb3JcblxuICAgIC8vIEFsbG93IG9ic2VydmVDaGFuZ2VzIGNhbGxzIHRvIHJldHVybi4gKEFmdGVyIHRoaXMsIGl0J3MgcG9zc2libGUgZm9yXG4gICAgLy8gc3RvcCgpIHRvIGJlIGNhbGxlZC4pXG4gICAgc2VsZi5fbXVsdGlwbGV4ZXIucmVhZHkoKTtcblxuICAgIHNlbGYuX2RvbmVRdWVyeWluZygpOyAgLy8geWllbGRzXG4gIH0sXG5cbiAgLy8gSW4gdmFyaW91cyBjaXJjdW1zdGFuY2VzLCB3ZSBtYXkganVzdCB3YW50IHRvIHN0b3AgcHJvY2Vzc2luZyB0aGUgb3Bsb2cgYW5kXG4gIC8vIHJlLXJ1biB0aGUgaW5pdGlhbCBxdWVyeSwganVzdCBhcyBpZiB3ZSB3ZXJlIGEgUG9sbGluZ09ic2VydmVEcml2ZXIuXG4gIC8vXG4gIC8vIFRoaXMgZnVuY3Rpb24gbWF5IG5vdCBibG9jaywgYmVjYXVzZSBpdCBpcyBjYWxsZWQgZnJvbSBhbiBvcGxvZyBlbnRyeVxuICAvLyBoYW5kbGVyLlxuICAvL1xuICAvLyBYWFggV2Ugc2hvdWxkIGNhbGwgdGhpcyB3aGVuIHdlIGRldGVjdCB0aGF0IHdlJ3ZlIGJlZW4gaW4gRkVUQ0hJTkcgZm9yIFwidG9vXG4gIC8vIGxvbmdcIi5cbiAgLy9cbiAgLy8gWFhYIFdlIHNob3VsZCBjYWxsIHRoaXMgd2hlbiB3ZSBkZXRlY3QgTW9uZ28gZmFpbG92ZXIgKHNpbmNlIHRoYXQgbWlnaHRcbiAgLy8gbWVhbiB0aGF0IHNvbWUgb2YgdGhlIG9wbG9nIGVudHJpZXMgd2UgaGF2ZSBwcm9jZXNzZWQgaGF2ZSBiZWVuIHJvbGxlZFxuICAvLyBiYWNrKS4gVGhlIE5vZGUgTW9uZ28gZHJpdmVyIGlzIGluIHRoZSBtaWRkbGUgb2YgYSBidW5jaCBvZiBodWdlXG4gIC8vIHJlZmFjdG9yaW5ncywgaW5jbHVkaW5nIHRoZSB3YXkgdGhhdCBpdCBub3RpZmllcyB5b3Ugd2hlbiBwcmltYXJ5XG4gIC8vIGNoYW5nZXMuIFdpbGwgcHV0IG9mZiBpbXBsZW1lbnRpbmcgdGhpcyB1bnRpbCBkcml2ZXIgMS40IGlzIG91dC5cbiAgX3BvbGxRdWVyeTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgICAgcmV0dXJuO1xuXG4gICAgICAvLyBZYXksIHdlIGdldCB0byBmb3JnZXQgYWJvdXQgYWxsIHRoZSB0aGluZ3Mgd2UgdGhvdWdodCB3ZSBoYWQgdG8gZmV0Y2guXG4gICAgICBzZWxmLl9uZWVkVG9GZXRjaCA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuICAgICAgc2VsZi5fY3VycmVudGx5RmV0Y2hpbmcgPSBudWxsO1xuICAgICAgKytzZWxmLl9mZXRjaEdlbmVyYXRpb247ICAvLyBpZ25vcmUgYW55IGluLWZsaWdodCBmZXRjaGVzXG4gICAgICBzZWxmLl9yZWdpc3RlclBoYXNlQ2hhbmdlKFBIQVNFLlFVRVJZSU5HKTtcblxuICAgICAgLy8gRGVmZXIgc28gdGhhdCB3ZSBkb24ndCB5aWVsZC4gIFdlIGRvbid0IG5lZWQgZmluaXNoSWZOZWVkVG9Qb2xsUXVlcnlcbiAgICAgIC8vIGhlcmUgYmVjYXVzZSBTd2l0Y2hlZFRvUXVlcnkgaXMgbm90IHRocm93biBpbiBRVUVSWUlORyBtb2RlLlxuICAgICAgTWV0ZW9yLmRlZmVyKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgc2VsZi5fcnVuUXVlcnkoKTtcbiAgICAgICAgc2VsZi5fZG9uZVF1ZXJ5aW5nKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSxcblxuICAvLyBZaWVsZHMhXG4gIF9ydW5RdWVyeTogZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gICAgdmFyIG5ld1Jlc3VsdHMsIG5ld0J1ZmZlcjtcblxuICAgIC8vIFRoaXMgd2hpbGUgbG9vcCBpcyBqdXN0IHRvIHJldHJ5IGZhaWx1cmVzLlxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAvLyBJZiB3ZSd2ZSBiZWVuIHN0b3BwZWQsIHdlIGRvbid0IGhhdmUgdG8gcnVuIGFueXRoaW5nIGFueSBtb3JlLlxuICAgICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICAgIHJldHVybjtcblxuICAgICAgbmV3UmVzdWx0cyA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuICAgICAgbmV3QnVmZmVyID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG5cbiAgICAgIC8vIFF1ZXJ5IDJ4IGRvY3VtZW50cyBhcyB0aGUgaGFsZiBleGNsdWRlZCBmcm9tIHRoZSBvcmlnaW5hbCBxdWVyeSB3aWxsIGdvXG4gICAgICAvLyBpbnRvIHVucHVibGlzaGVkIGJ1ZmZlciB0byByZWR1Y2UgYWRkaXRpb25hbCBNb25nbyBsb29rdXBzIGluIGNhc2VzXG4gICAgICAvLyB3aGVuIGRvY3VtZW50cyBhcmUgcmVtb3ZlZCBmcm9tIHRoZSBwdWJsaXNoZWQgc2V0IGFuZCBuZWVkIGFcbiAgICAgIC8vIHJlcGxhY2VtZW50LlxuICAgICAgLy8gWFhYIG5lZWRzIG1vcmUgdGhvdWdodCBvbiBub24temVybyBza2lwXG4gICAgICAvLyBYWFggMiBpcyBhIFwibWFnaWMgbnVtYmVyXCIgbWVhbmluZyB0aGVyZSBpcyBhbiBleHRyYSBjaHVuayBvZiBkb2NzIGZvclxuICAgICAgLy8gYnVmZmVyIGlmIHN1Y2ggaXMgbmVlZGVkLlxuICAgICAgdmFyIGN1cnNvciA9IHNlbGYuX2N1cnNvckZvclF1ZXJ5KHsgbGltaXQ6IHNlbGYuX2xpbWl0ICogMiB9KTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGN1cnNvci5mb3JFYWNoKGZ1bmN0aW9uIChkb2MsIGkpIHsgIC8vIHlpZWxkc1xuICAgICAgICAgIGlmICghc2VsZi5fbGltaXQgfHwgaSA8IHNlbGYuX2xpbWl0KSB7XG4gICAgICAgICAgICBuZXdSZXN1bHRzLnNldChkb2MuX2lkLCBkb2MpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBuZXdCdWZmZXIuc2V0KGRvYy5faWQsIGRvYyk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGlmIChvcHRpb25zLmluaXRpYWwgJiYgdHlwZW9mKGUuY29kZSkgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgLy8gVGhpcyBpcyBhbiBlcnJvciBkb2N1bWVudCBzZW50IHRvIHVzIGJ5IG1vbmdvZCwgbm90IGEgY29ubmVjdGlvblxuICAgICAgICAgIC8vIGVycm9yIGdlbmVyYXRlZCBieSB0aGUgY2xpZW50LiBBbmQgd2UndmUgbmV2ZXIgc2VlbiB0aGlzIHF1ZXJ5IHdvcmtcbiAgICAgICAgICAvLyBzdWNjZXNzZnVsbHkuIFByb2JhYmx5IGl0J3MgYSBiYWQgc2VsZWN0b3Igb3Igc29tZXRoaW5nLCBzbyB3ZVxuICAgICAgICAgIC8vIHNob3VsZCBOT1QgcmV0cnkuIEluc3RlYWQsIHdlIHNob3VsZCBoYWx0IHRoZSBvYnNlcnZlICh3aGljaCBlbmRzXG4gICAgICAgICAgLy8gdXAgY2FsbGluZyBgc3RvcGAgb24gdXMpLlxuICAgICAgICAgIHNlbGYuX211bHRpcGxleGVyLnF1ZXJ5RXJyb3IoZSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRHVyaW5nIGZhaWxvdmVyIChlZykgaWYgd2UgZ2V0IGFuIGV4Y2VwdGlvbiB3ZSBzaG91bGQgbG9nIGFuZCByZXRyeVxuICAgICAgICAvLyBpbnN0ZWFkIG9mIGNyYXNoaW5nLlxuICAgICAgICBNZXRlb3IuX2RlYnVnKFwiR290IGV4Y2VwdGlvbiB3aGlsZSBwb2xsaW5nIHF1ZXJ5OiBcIiArIGUpO1xuICAgICAgICBNZXRlb3IuX3NsZWVwRm9yTXMoMTAwKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgIHJldHVybjtcblxuICAgIHNlbGYuX3B1Ymxpc2hOZXdSZXN1bHRzKG5ld1Jlc3VsdHMsIG5ld0J1ZmZlcik7XG4gIH0sXG5cbiAgLy8gVHJhbnNpdGlvbnMgdG8gUVVFUllJTkcgYW5kIHJ1bnMgYW5vdGhlciBxdWVyeSwgb3IgKGlmIGFscmVhZHkgaW4gUVVFUllJTkcpXG4gIC8vIGVuc3VyZXMgdGhhdCB3ZSB3aWxsIHF1ZXJ5IGFnYWluIGxhdGVyLlxuICAvL1xuICAvLyBUaGlzIGZ1bmN0aW9uIG1heSBub3QgYmxvY2ssIGJlY2F1c2UgaXQgaXMgY2FsbGVkIGZyb20gYW4gb3Bsb2cgZW50cnlcbiAgLy8gaGFuZGxlci4gSG93ZXZlciwgaWYgd2Ugd2VyZSBub3QgYWxyZWFkeSBpbiB0aGUgUVVFUllJTkcgcGhhc2UsIGl0IHRocm93c1xuICAvLyBhbiBleGNlcHRpb24gdGhhdCBpcyBjYXVnaHQgYnkgdGhlIGNsb3Nlc3Qgc3Vycm91bmRpbmdcbiAgLy8gZmluaXNoSWZOZWVkVG9Qb2xsUXVlcnkgY2FsbDsgdGhpcyBlbnN1cmVzIHRoYXQgd2UgZG9uJ3QgY29udGludWUgcnVubmluZ1xuICAvLyBjbG9zZSB0aGF0IHdhcyBkZXNpZ25lZCBmb3IgYW5vdGhlciBwaGFzZSBpbnNpZGUgUEhBU0UuUVVFUllJTkcuXG4gIC8vXG4gIC8vIChJdCdzIGFsc28gbmVjZXNzYXJ5IHdoZW5ldmVyIGxvZ2ljIGluIHRoaXMgZmlsZSB5aWVsZHMgdG8gY2hlY2sgdGhhdCBvdGhlclxuICAvLyBwaGFzZXMgaGF2ZW4ndCBwdXQgdXMgaW50byBRVUVSWUlORyBtb2RlLCB0aG91Z2g7IGVnLFxuICAvLyBfZmV0Y2hNb2RpZmllZERvY3VtZW50cyBkb2VzIHRoaXMuKVxuICBfbmVlZFRvUG9sbFF1ZXJ5OiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgICAgICByZXR1cm47XG5cbiAgICAgIC8vIElmIHdlJ3JlIG5vdCBhbHJlYWR5IGluIHRoZSBtaWRkbGUgb2YgYSBxdWVyeSwgd2UgY2FuIHF1ZXJ5IG5vd1xuICAgICAgLy8gKHBvc3NpYmx5IHBhdXNpbmcgRkVUQ0hJTkcpLlxuICAgICAgaWYgKHNlbGYuX3BoYXNlICE9PSBQSEFTRS5RVUVSWUlORykge1xuICAgICAgICBzZWxmLl9wb2xsUXVlcnkoKTtcbiAgICAgICAgdGhyb3cgbmV3IFN3aXRjaGVkVG9RdWVyeTtcbiAgICAgIH1cblxuICAgICAgLy8gV2UncmUgY3VycmVudGx5IGluIFFVRVJZSU5HLiBTZXQgYSBmbGFnIHRvIGVuc3VyZSB0aGF0IHdlIHJ1biBhbm90aGVyXG4gICAgICAvLyBxdWVyeSB3aGVuIHdlJ3JlIGRvbmUuXG4gICAgICBzZWxmLl9yZXF1ZXJ5V2hlbkRvbmVUaGlzUXVlcnkgPSB0cnVlO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIFlpZWxkcyFcbiAgX2RvbmVRdWVyeWluZzogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgICAgcmV0dXJuO1xuICAgIHNlbGYuX21vbmdvSGFuZGxlLl9vcGxvZ0hhbmRsZS53YWl0VW50aWxDYXVnaHRVcCgpOyAgLy8geWllbGRzXG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47XG4gICAgaWYgKHNlbGYuX3BoYXNlICE9PSBQSEFTRS5RVUVSWUlORylcbiAgICAgIHRocm93IEVycm9yKFwiUGhhc2UgdW5leHBlY3RlZGx5IFwiICsgc2VsZi5fcGhhc2UpO1xuXG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKHNlbGYuX3JlcXVlcnlXaGVuRG9uZVRoaXNRdWVyeSkge1xuICAgICAgICBzZWxmLl9yZXF1ZXJ5V2hlbkRvbmVUaGlzUXVlcnkgPSBmYWxzZTtcbiAgICAgICAgc2VsZi5fcG9sbFF1ZXJ5KCk7XG4gICAgICB9IGVsc2UgaWYgKHNlbGYuX25lZWRUb0ZldGNoLmVtcHR5KCkpIHtcbiAgICAgICAgc2VsZi5fYmVTdGVhZHkoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYuX2ZldGNoTW9kaWZpZWREb2N1bWVudHMoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcblxuICBfY3Vyc29yRm9yUXVlcnk6IGZ1bmN0aW9uIChvcHRpb25zT3ZlcndyaXRlKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICAvLyBUaGUgcXVlcnkgd2UgcnVuIGlzIGFsbW9zdCB0aGUgc2FtZSBhcyB0aGUgY3Vyc29yIHdlIGFyZSBvYnNlcnZpbmcsXG4gICAgICAvLyB3aXRoIGEgZmV3IGNoYW5nZXMuIFdlIG5lZWQgdG8gcmVhZCBhbGwgdGhlIGZpZWxkcyB0aGF0IGFyZSByZWxldmFudCB0b1xuICAgICAgLy8gdGhlIHNlbGVjdG9yLCBub3QganVzdCB0aGUgZmllbGRzIHdlIGFyZSBnb2luZyB0byBwdWJsaXNoICh0aGF0J3MgdGhlXG4gICAgICAvLyBcInNoYXJlZFwiIHByb2plY3Rpb24pLiBBbmQgd2UgZG9uJ3Qgd2FudCB0byBhcHBseSBhbnkgdHJhbnNmb3JtIGluIHRoZVxuICAgICAgLy8gY3Vyc29yLCBiZWNhdXNlIG9ic2VydmVDaGFuZ2VzIHNob3VsZG4ndCB1c2UgdGhlIHRyYW5zZm9ybS5cbiAgICAgIHZhciBvcHRpb25zID0gXy5jbG9uZShzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zKTtcblxuICAgICAgLy8gQWxsb3cgdGhlIGNhbGxlciB0byBtb2RpZnkgdGhlIG9wdGlvbnMuIFVzZWZ1bCB0byBzcGVjaWZ5IGRpZmZlcmVudFxuICAgICAgLy8gc2tpcCBhbmQgbGltaXQgdmFsdWVzLlxuICAgICAgXy5leHRlbmQob3B0aW9ucywgb3B0aW9uc092ZXJ3cml0ZSk7XG5cbiAgICAgIG9wdGlvbnMuZmllbGRzID0gc2VsZi5fc2hhcmVkUHJvamVjdGlvbjtcbiAgICAgIGRlbGV0ZSBvcHRpb25zLnRyYW5zZm9ybTtcbiAgICAgIC8vIFdlIGFyZSBOT1QgZGVlcCBjbG9uaW5nIGZpZWxkcyBvciBzZWxlY3RvciBoZXJlLCB3aGljaCBzaG91bGQgYmUgT0suXG4gICAgICB2YXIgZGVzY3JpcHRpb24gPSBuZXcgQ3Vyc29yRGVzY3JpcHRpb24oXG4gICAgICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLmNvbGxlY3Rpb25OYW1lLFxuICAgICAgICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5zZWxlY3RvcixcbiAgICAgICAgb3B0aW9ucyk7XG4gICAgICByZXR1cm4gbmV3IEN1cnNvcihzZWxmLl9tb25nb0hhbmRsZSwgZGVzY3JpcHRpb24pO1xuICAgIH0pO1xuICB9LFxuXG5cbiAgLy8gUmVwbGFjZSBzZWxmLl9wdWJsaXNoZWQgd2l0aCBuZXdSZXN1bHRzIChib3RoIGFyZSBJZE1hcHMpLCBpbnZva2luZyBvYnNlcnZlXG4gIC8vIGNhbGxiYWNrcyBvbiB0aGUgbXVsdGlwbGV4ZXIuXG4gIC8vIFJlcGxhY2Ugc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIgd2l0aCBuZXdCdWZmZXIuXG4gIC8vXG4gIC8vIFhYWCBUaGlzIGlzIHZlcnkgc2ltaWxhciB0byBMb2NhbENvbGxlY3Rpb24uX2RpZmZRdWVyeVVub3JkZXJlZENoYW5nZXMuIFdlXG4gIC8vIHNob3VsZCByZWFsbHk6IChhKSBVbmlmeSBJZE1hcCBhbmQgT3JkZXJlZERpY3QgaW50byBVbm9yZGVyZWQvT3JkZXJlZERpY3RcbiAgLy8gKGIpIFJld3JpdGUgZGlmZi5qcyB0byB1c2UgdGhlc2UgY2xhc3NlcyBpbnN0ZWFkIG9mIGFycmF5cyBhbmQgb2JqZWN0cy5cbiAgX3B1Ymxpc2hOZXdSZXN1bHRzOiBmdW5jdGlvbiAobmV3UmVzdWx0cywgbmV3QnVmZmVyKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcblxuICAgICAgLy8gSWYgdGhlIHF1ZXJ5IGlzIGxpbWl0ZWQgYW5kIHRoZXJlIGlzIGEgYnVmZmVyLCBzaHV0IGRvd24gc28gaXQgZG9lc24ndFxuICAgICAgLy8gc3RheSBpbiBhIHdheS5cbiAgICAgIGlmIChzZWxmLl9saW1pdCkge1xuICAgICAgICBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5jbGVhcigpO1xuICAgICAgfVxuXG4gICAgICAvLyBGaXJzdCByZW1vdmUgYW55dGhpbmcgdGhhdCdzIGdvbmUuIEJlIGNhcmVmdWwgbm90IHRvIG1vZGlmeVxuICAgICAgLy8gc2VsZi5fcHVibGlzaGVkIHdoaWxlIGl0ZXJhdGluZyBvdmVyIGl0LlxuICAgICAgdmFyIGlkc1RvUmVtb3ZlID0gW107XG4gICAgICBzZWxmLl9wdWJsaXNoZWQuZm9yRWFjaChmdW5jdGlvbiAoZG9jLCBpZCkge1xuICAgICAgICBpZiAoIW5ld1Jlc3VsdHMuaGFzKGlkKSlcbiAgICAgICAgICBpZHNUb1JlbW92ZS5wdXNoKGlkKTtcbiAgICAgIH0pO1xuICAgICAgXy5lYWNoKGlkc1RvUmVtb3ZlLCBmdW5jdGlvbiAoaWQpIHtcbiAgICAgICAgc2VsZi5fcmVtb3ZlUHVibGlzaGVkKGlkKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBOb3cgZG8gYWRkcyBhbmQgY2hhbmdlcy5cbiAgICAgIC8vIElmIHNlbGYgaGFzIGEgYnVmZmVyIGFuZCBsaW1pdCwgdGhlIG5ldyBmZXRjaGVkIHJlc3VsdCB3aWxsIGJlXG4gICAgICAvLyBsaW1pdGVkIGNvcnJlY3RseSBhcyB0aGUgcXVlcnkgaGFzIHNvcnQgc3BlY2lmaWVyLlxuICAgICAgbmV3UmVzdWx0cy5mb3JFYWNoKGZ1bmN0aW9uIChkb2MsIGlkKSB7XG4gICAgICAgIHNlbGYuX2hhbmRsZURvYyhpZCwgZG9jKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBTYW5pdHktY2hlY2sgdGhhdCBldmVyeXRoaW5nIHdlIHRyaWVkIHRvIHB1dCBpbnRvIF9wdWJsaXNoZWQgZW5kZWQgdXBcbiAgICAgIC8vIHRoZXJlLlxuICAgICAgLy8gWFhYIGlmIHRoaXMgaXMgc2xvdywgcmVtb3ZlIGl0IGxhdGVyXG4gICAgICBpZiAoc2VsZi5fcHVibGlzaGVkLnNpemUoKSAhPT0gbmV3UmVzdWx0cy5zaXplKCkpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoXG4gICAgICAgICAgXCJUaGUgTW9uZ28gc2VydmVyIGFuZCB0aGUgTWV0ZW9yIHF1ZXJ5IGRpc2FncmVlIG9uIGhvdyBcIiArXG4gICAgICAgICAgICBcIm1hbnkgZG9jdW1lbnRzIG1hdGNoIHlvdXIgcXVlcnkuIE1heWJlIGl0IGlzIGhpdHRpbmcgYSBNb25nbyBcIiArXG4gICAgICAgICAgICBcImVkZ2UgY2FzZT8gVGhlIHF1ZXJ5IGlzOiBcIiArXG4gICAgICAgICAgICBFSlNPTi5zdHJpbmdpZnkoc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24uc2VsZWN0b3IpKTtcbiAgICAgIH1cbiAgICAgIHNlbGYuX3B1Ymxpc2hlZC5mb3JFYWNoKGZ1bmN0aW9uIChkb2MsIGlkKSB7XG4gICAgICAgIGlmICghbmV3UmVzdWx0cy5oYXMoaWQpKVxuICAgICAgICAgIHRocm93IEVycm9yKFwiX3B1Ymxpc2hlZCBoYXMgYSBkb2MgdGhhdCBuZXdSZXN1bHRzIGRvZXNuJ3Q7IFwiICsgaWQpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIEZpbmFsbHksIHJlcGxhY2UgdGhlIGJ1ZmZlclxuICAgICAgbmV3QnVmZmVyLmZvckVhY2goZnVuY3Rpb24gKGRvYywgaWQpIHtcbiAgICAgICAgc2VsZi5fYWRkQnVmZmVyZWQoaWQsIGRvYyk7XG4gICAgICB9KTtcblxuICAgICAgc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyID0gbmV3QnVmZmVyLnNpemUoKSA8IHNlbGYuX2xpbWl0O1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIFRoaXMgc3RvcCBmdW5jdGlvbiBpcyBpbnZva2VkIGZyb20gdGhlIG9uU3RvcCBvZiB0aGUgT2JzZXJ2ZU11bHRpcGxleGVyLCBzb1xuICAvLyBpdCBzaG91bGRuJ3QgYWN0dWFsbHkgYmUgcG9zc2libGUgdG8gY2FsbCBpdCB1bnRpbCB0aGUgbXVsdGlwbGV4ZXIgaXNcbiAgLy8gcmVhZHkuXG4gIC8vXG4gIC8vIEl0J3MgaW1wb3J0YW50IHRvIGNoZWNrIHNlbGYuX3N0b3BwZWQgYWZ0ZXIgZXZlcnkgY2FsbCBpbiB0aGlzIGZpbGUgdGhhdFxuICAvLyBjYW4geWllbGQhXG4gIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47XG4gICAgc2VsZi5fc3RvcHBlZCA9IHRydWU7XG4gICAgXy5lYWNoKHNlbGYuX3N0b3BIYW5kbGVzLCBmdW5jdGlvbiAoaGFuZGxlKSB7XG4gICAgICBoYW5kbGUuc3RvcCgpO1xuICAgIH0pO1xuXG4gICAgLy8gTm90ZTogd2UgKmRvbid0KiB1c2UgbXVsdGlwbGV4ZXIub25GbHVzaCBoZXJlIGJlY2F1c2UgdGhpcyBzdG9wXG4gICAgLy8gY2FsbGJhY2sgaXMgYWN0dWFsbHkgaW52b2tlZCBieSB0aGUgbXVsdGlwbGV4ZXIgaXRzZWxmIHdoZW4gaXQgaGFzXG4gICAgLy8gZGV0ZXJtaW5lZCB0aGF0IHRoZXJlIGFyZSBubyBoYW5kbGVzIGxlZnQuIFNvIG5vdGhpbmcgaXMgYWN0dWFsbHkgZ29pbmdcbiAgICAvLyB0byBnZXQgZmx1c2hlZCAoYW5kIGl0J3MgcHJvYmFibHkgbm90IHZhbGlkIHRvIGNhbGwgbWV0aG9kcyBvbiB0aGVcbiAgICAvLyBkeWluZyBtdWx0aXBsZXhlcikuXG4gICAgXy5lYWNoKHNlbGYuX3dyaXRlc1RvQ29tbWl0V2hlbldlUmVhY2hTdGVhZHksIGZ1bmN0aW9uICh3KSB7XG4gICAgICB3LmNvbW1pdHRlZCgpOyAgLy8gbWF5YmUgeWllbGRzP1xuICAgIH0pO1xuICAgIHNlbGYuX3dyaXRlc1RvQ29tbWl0V2hlbldlUmVhY2hTdGVhZHkgPSBudWxsO1xuXG4gICAgLy8gUHJvYWN0aXZlbHkgZHJvcCByZWZlcmVuY2VzIHRvIHBvdGVudGlhbGx5IGJpZyB0aGluZ3MuXG4gICAgc2VsZi5fcHVibGlzaGVkID0gbnVsbDtcbiAgICBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlciA9IG51bGw7XG4gICAgc2VsZi5fbmVlZFRvRmV0Y2ggPSBudWxsO1xuICAgIHNlbGYuX2N1cnJlbnRseUZldGNoaW5nID0gbnVsbDtcbiAgICBzZWxmLl9vcGxvZ0VudHJ5SGFuZGxlID0gbnVsbDtcbiAgICBzZWxmLl9saXN0ZW5lcnNIYW5kbGUgPSBudWxsO1xuXG4gICAgUGFja2FnZS5mYWN0cyAmJiBQYWNrYWdlLmZhY3RzLkZhY3RzLmluY3JlbWVudFNlcnZlckZhY3QoXG4gICAgICBcIm1vbmdvLWxpdmVkYXRhXCIsIFwib2JzZXJ2ZS1kcml2ZXJzLW9wbG9nXCIsIC0xKTtcbiAgfSxcblxuICBfcmVnaXN0ZXJQaGFzZUNoYW5nZTogZnVuY3Rpb24gKHBoYXNlKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHZhciBub3cgPSBuZXcgRGF0ZTtcblxuICAgICAgaWYgKHNlbGYuX3BoYXNlKSB7XG4gICAgICAgIHZhciB0aW1lRGlmZiA9IG5vdyAtIHNlbGYuX3BoYXNlU3RhcnRUaW1lO1xuICAgICAgICBQYWNrYWdlLmZhY3RzICYmIFBhY2thZ2UuZmFjdHMuRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgICAgICBcIm1vbmdvLWxpdmVkYXRhXCIsIFwidGltZS1zcGVudC1pbi1cIiArIHNlbGYuX3BoYXNlICsgXCItcGhhc2VcIiwgdGltZURpZmYpO1xuICAgICAgfVxuXG4gICAgICBzZWxmLl9waGFzZSA9IHBoYXNlO1xuICAgICAgc2VsZi5fcGhhc2VTdGFydFRpbWUgPSBub3c7XG4gICAgfSk7XG4gIH1cbn0pO1xuXG4vLyBEb2VzIG91ciBvcGxvZyB0YWlsaW5nIGNvZGUgc3VwcG9ydCB0aGlzIGN1cnNvcj8gRm9yIG5vdywgd2UgYXJlIGJlaW5nIHZlcnlcbi8vIGNvbnNlcnZhdGl2ZSBhbmQgYWxsb3dpbmcgb25seSBzaW1wbGUgcXVlcmllcyB3aXRoIHNpbXBsZSBvcHRpb25zLlxuLy8gKFRoaXMgaXMgYSBcInN0YXRpYyBtZXRob2RcIi4pXG5PcGxvZ09ic2VydmVEcml2ZXIuY3Vyc29yU3VwcG9ydGVkID0gZnVuY3Rpb24gKGN1cnNvckRlc2NyaXB0aW9uLCBtYXRjaGVyKSB7XG4gIC8vIEZpcnN0LCBjaGVjayB0aGUgb3B0aW9ucy5cbiAgdmFyIG9wdGlvbnMgPSBjdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zO1xuXG4gIC8vIERpZCB0aGUgdXNlciBzYXkgbm8gZXhwbGljaXRseT9cbiAgLy8gdW5kZXJzY29yZWQgdmVyc2lvbiBvZiB0aGUgb3B0aW9uIGlzIENPTVBBVCB3aXRoIDEuMlxuICBpZiAob3B0aW9ucy5kaXNhYmxlT3Bsb2cgfHwgb3B0aW9ucy5fZGlzYWJsZU9wbG9nKVxuICAgIHJldHVybiBmYWxzZTtcblxuICAvLyBza2lwIGlzIG5vdCBzdXBwb3J0ZWQ6IHRvIHN1cHBvcnQgaXQgd2Ugd291bGQgbmVlZCB0byBrZWVwIHRyYWNrIG9mIGFsbFxuICAvLyBcInNraXBwZWRcIiBkb2N1bWVudHMgb3IgYXQgbGVhc3QgdGhlaXIgaWRzLlxuICAvLyBsaW1pdCB3L28gYSBzb3J0IHNwZWNpZmllciBpcyBub3Qgc3VwcG9ydGVkOiBjdXJyZW50IGltcGxlbWVudGF0aW9uIG5lZWRzIGFcbiAgLy8gZGV0ZXJtaW5pc3RpYyB3YXkgdG8gb3JkZXIgZG9jdW1lbnRzLlxuICBpZiAob3B0aW9ucy5za2lwIHx8IChvcHRpb25zLmxpbWl0ICYmICFvcHRpb25zLnNvcnQpKSByZXR1cm4gZmFsc2U7XG5cbiAgLy8gSWYgYSBmaWVsZHMgcHJvamVjdGlvbiBvcHRpb24gaXMgZ2l2ZW4gY2hlY2sgaWYgaXQgaXMgc3VwcG9ydGVkIGJ5XG4gIC8vIG1pbmltb25nbyAoc29tZSBvcGVyYXRvcnMgYXJlIG5vdCBzdXBwb3J0ZWQpLlxuICBpZiAob3B0aW9ucy5maWVsZHMpIHtcbiAgICB0cnkge1xuICAgICAgTG9jYWxDb2xsZWN0aW9uLl9jaGVja1N1cHBvcnRlZFByb2plY3Rpb24ob3B0aW9ucy5maWVsZHMpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChlLm5hbWUgPT09IFwiTWluaW1vbmdvRXJyb3JcIikge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFdlIGRvbid0IGFsbG93IHRoZSBmb2xsb3dpbmcgc2VsZWN0b3JzOlxuICAvLyAgIC0gJHdoZXJlIChub3QgY29uZmlkZW50IHRoYXQgd2UgcHJvdmlkZSB0aGUgc2FtZSBKUyBlbnZpcm9ubWVudFxuICAvLyAgICAgICAgICAgICBhcyBNb25nbywgYW5kIGNhbiB5aWVsZCEpXG4gIC8vICAgLSAkbmVhciAoaGFzIFwiaW50ZXJlc3RpbmdcIiBwcm9wZXJ0aWVzIGluIE1vbmdvREIsIGxpa2UgdGhlIHBvc3NpYmlsaXR5XG4gIC8vICAgICAgICAgICAgb2YgcmV0dXJuaW5nIGFuIElEIG11bHRpcGxlIHRpbWVzLCB0aG91Z2ggZXZlbiBwb2xsaW5nIG1heWJlXG4gIC8vICAgICAgICAgICAgaGF2ZSBhIGJ1ZyB0aGVyZSlcbiAgLy8gICAgICAgICAgIFhYWDogb25jZSB3ZSBzdXBwb3J0IGl0LCB3ZSB3b3VsZCBuZWVkIHRvIHRoaW5rIG1vcmUgb24gaG93IHdlXG4gIC8vICAgICAgICAgICBpbml0aWFsaXplIHRoZSBjb21wYXJhdG9ycyB3aGVuIHdlIGNyZWF0ZSB0aGUgZHJpdmVyLlxuICByZXR1cm4gIW1hdGNoZXIuaGFzV2hlcmUoKSAmJiAhbWF0Y2hlci5oYXNHZW9RdWVyeSgpO1xufTtcblxudmFyIG1vZGlmaWVyQ2FuQmVEaXJlY3RseUFwcGxpZWQgPSBmdW5jdGlvbiAobW9kaWZpZXIpIHtcbiAgcmV0dXJuIF8uYWxsKG1vZGlmaWVyLCBmdW5jdGlvbiAoZmllbGRzLCBvcGVyYXRpb24pIHtcbiAgICByZXR1cm4gXy5hbGwoZmllbGRzLCBmdW5jdGlvbiAodmFsdWUsIGZpZWxkKSB7XG4gICAgICByZXR1cm4gIS9FSlNPTlxcJC8udGVzdChmaWVsZCk7XG4gICAgfSk7XG4gIH0pO1xufTtcblxuTW9uZ29JbnRlcm5hbHMuT3Bsb2dPYnNlcnZlRHJpdmVyID0gT3Bsb2dPYnNlcnZlRHJpdmVyO1xuIiwiLy8gc2luZ2xldG9uXG5leHBvcnQgY29uc3QgTG9jYWxDb2xsZWN0aW9uRHJpdmVyID0gbmV3IChjbGFzcyBMb2NhbENvbGxlY3Rpb25Ecml2ZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLm5vQ29ubkNvbGxlY3Rpb25zID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgfVxuXG4gIG9wZW4obmFtZSwgY29ubikge1xuICAgIGlmICghIG5hbWUpIHtcbiAgICAgIHJldHVybiBuZXcgTG9jYWxDb2xsZWN0aW9uO1xuICAgIH1cblxuICAgIGlmICghIGNvbm4pIHtcbiAgICAgIHJldHVybiBlbnN1cmVDb2xsZWN0aW9uKG5hbWUsIHRoaXMubm9Db25uQ29sbGVjdGlvbnMpO1xuICAgIH1cblxuICAgIGlmICghIGNvbm4uX21vbmdvX2xpdmVkYXRhX2NvbGxlY3Rpb25zKSB7XG4gICAgICBjb25uLl9tb25nb19saXZlZGF0YV9jb2xsZWN0aW9ucyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gICAgfVxuXG4gICAgLy8gWFhYIGlzIHRoZXJlIGEgd2F5IHRvIGtlZXAgdHJhY2sgb2YgYSBjb25uZWN0aW9uJ3MgY29sbGVjdGlvbnMgd2l0aG91dFxuICAgIC8vIGRhbmdsaW5nIGl0IG9mZiB0aGUgY29ubmVjdGlvbiBvYmplY3Q/XG4gICAgcmV0dXJuIGVuc3VyZUNvbGxlY3Rpb24obmFtZSwgY29ubi5fbW9uZ29fbGl2ZWRhdGFfY29sbGVjdGlvbnMpO1xuICB9XG59KTtcblxuZnVuY3Rpb24gZW5zdXJlQ29sbGVjdGlvbihuYW1lLCBjb2xsZWN0aW9ucykge1xuICByZXR1cm4gKG5hbWUgaW4gY29sbGVjdGlvbnMpXG4gICAgPyBjb2xsZWN0aW9uc1tuYW1lXVxuICAgIDogY29sbGVjdGlvbnNbbmFtZV0gPSBuZXcgTG9jYWxDb2xsZWN0aW9uKG5hbWUpO1xufVxuIiwiTW9uZ29JbnRlcm5hbHMuUmVtb3RlQ29sbGVjdGlvbkRyaXZlciA9IGZ1bmN0aW9uIChcbiAgbW9uZ29fdXJsLCBvcHRpb25zKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5tb25nbyA9IG5ldyBNb25nb0Nvbm5lY3Rpb24obW9uZ29fdXJsLCBvcHRpb25zKTtcbn07XG5cbl8uZXh0ZW5kKE1vbmdvSW50ZXJuYWxzLlJlbW90ZUNvbGxlY3Rpb25Ecml2ZXIucHJvdG90eXBlLCB7XG4gIG9wZW46IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciByZXQgPSB7fTtcbiAgICBfLmVhY2goXG4gICAgICBbJ2ZpbmQnLCAnZmluZE9uZScsICdpbnNlcnQnLCAndXBkYXRlJywgJ3Vwc2VydCcsXG4gICAgICAgJ3JlbW92ZScsICdfZW5zdXJlSW5kZXgnLCAnX2Ryb3BJbmRleCcsICdfY3JlYXRlQ2FwcGVkQ29sbGVjdGlvbicsXG4gICAgICAgJ2Ryb3BDb2xsZWN0aW9uJywgJ3Jhd0NvbGxlY3Rpb24nXSxcbiAgICAgIGZ1bmN0aW9uIChtKSB7XG4gICAgICAgIHJldFttXSA9IF8uYmluZChzZWxmLm1vbmdvW21dLCBzZWxmLm1vbmdvLCBuYW1lKTtcbiAgICAgIH0pO1xuICAgIHJldHVybiByZXQ7XG4gIH1cbn0pO1xuXG5cbi8vIENyZWF0ZSB0aGUgc2luZ2xldG9uIFJlbW90ZUNvbGxlY3Rpb25Ecml2ZXIgb25seSBvbiBkZW1hbmQsIHNvIHdlXG4vLyBvbmx5IHJlcXVpcmUgTW9uZ28gY29uZmlndXJhdGlvbiBpZiBpdCdzIGFjdHVhbGx5IHVzZWQgKGVnLCBub3QgaWZcbi8vIHlvdSdyZSBvbmx5IHRyeWluZyB0byByZWNlaXZlIGRhdGEgZnJvbSBhIHJlbW90ZSBERFAgc2VydmVyLilcbk1vbmdvSW50ZXJuYWxzLmRlZmF1bHRSZW1vdGVDb2xsZWN0aW9uRHJpdmVyID0gXy5vbmNlKGZ1bmN0aW9uICgpIHtcbiAgdmFyIGNvbm5lY3Rpb25PcHRpb25zID0ge307XG5cbiAgdmFyIG1vbmdvVXJsID0gcHJvY2Vzcy5lbnYuTU9OR09fVVJMO1xuXG4gIGlmIChwcm9jZXNzLmVudi5NT05HT19PUExPR19VUkwpIHtcbiAgICBjb25uZWN0aW9uT3B0aW9ucy5vcGxvZ1VybCA9IHByb2Nlc3MuZW52Lk1PTkdPX09QTE9HX1VSTDtcbiAgfVxuXG4gIGlmICghIG1vbmdvVXJsKVxuICAgIHRocm93IG5ldyBFcnJvcihcIk1PTkdPX1VSTCBtdXN0IGJlIHNldCBpbiBlbnZpcm9ubWVudFwiKTtcblxuICByZXR1cm4gbmV3IE1vbmdvSW50ZXJuYWxzLlJlbW90ZUNvbGxlY3Rpb25Ecml2ZXIobW9uZ29VcmwsIGNvbm5lY3Rpb25PcHRpb25zKTtcbn0pO1xuIiwiLy8gb3B0aW9ucy5jb25uZWN0aW9uLCBpZiBnaXZlbiwgaXMgYSBMaXZlZGF0YUNsaWVudCBvciBMaXZlZGF0YVNlcnZlclxuLy8gWFhYIHByZXNlbnRseSB0aGVyZSBpcyBubyB3YXkgdG8gZGVzdHJveS9jbGVhbiB1cCBhIENvbGxlY3Rpb25cblxuLyoqXG4gKiBAc3VtbWFyeSBOYW1lc3BhY2UgZm9yIE1vbmdvREItcmVsYXRlZCBpdGVtc1xuICogQG5hbWVzcGFjZVxuICovXG5Nb25nbyA9IHt9O1xuXG4vKipcbiAqIEBzdW1tYXJ5IENvbnN0cnVjdG9yIGZvciBhIENvbGxlY3Rpb25cbiAqIEBsb2N1cyBBbnl3aGVyZVxuICogQGluc3RhbmNlbmFtZSBjb2xsZWN0aW9uXG4gKiBAY2xhc3NcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIFRoZSBuYW1lIG9mIHRoZSBjb2xsZWN0aW9uLiAgSWYgbnVsbCwgY3JlYXRlcyBhbiB1bm1hbmFnZWQgKHVuc3luY2hyb25pemVkKSBsb2NhbCBjb2xsZWN0aW9uLlxuICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXVxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMuY29ubmVjdGlvbiBUaGUgc2VydmVyIGNvbm5lY3Rpb24gdGhhdCB3aWxsIG1hbmFnZSB0aGlzIGNvbGxlY3Rpb24uIFVzZXMgdGhlIGRlZmF1bHQgY29ubmVjdGlvbiBpZiBub3Qgc3BlY2lmaWVkLiAgUGFzcyB0aGUgcmV0dXJuIHZhbHVlIG9mIGNhbGxpbmcgW2BERFAuY29ubmVjdGBdKCNkZHBfY29ubmVjdCkgdG8gc3BlY2lmeSBhIGRpZmZlcmVudCBzZXJ2ZXIuIFBhc3MgYG51bGxgIHRvIHNwZWNpZnkgbm8gY29ubmVjdGlvbi4gVW5tYW5hZ2VkIChgbmFtZWAgaXMgbnVsbCkgY29sbGVjdGlvbnMgY2Fubm90IHNwZWNpZnkgYSBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtTdHJpbmd9IG9wdGlvbnMuaWRHZW5lcmF0aW9uIFRoZSBtZXRob2Qgb2YgZ2VuZXJhdGluZyB0aGUgYF9pZGAgZmllbGRzIG9mIG5ldyBkb2N1bWVudHMgaW4gdGhpcyBjb2xsZWN0aW9uLiAgUG9zc2libGUgdmFsdWVzOlxuXG4gLSAqKmAnU1RSSU5HJ2AqKjogcmFuZG9tIHN0cmluZ3NcbiAtICoqYCdNT05HTydgKio6ICByYW5kb20gW2BNb25nby5PYmplY3RJRGBdKCNtb25nb19vYmplY3RfaWQpIHZhbHVlc1xuXG5UaGUgZGVmYXVsdCBpZCBnZW5lcmF0aW9uIHRlY2huaXF1ZSBpcyBgJ1NUUklORydgLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gb3B0aW9ucy50cmFuc2Zvcm0gQW4gb3B0aW9uYWwgdHJhbnNmb3JtYXRpb24gZnVuY3Rpb24uIERvY3VtZW50cyB3aWxsIGJlIHBhc3NlZCB0aHJvdWdoIHRoaXMgZnVuY3Rpb24gYmVmb3JlIGJlaW5nIHJldHVybmVkIGZyb20gYGZldGNoYCBvciBgZmluZE9uZWAsIGFuZCBiZWZvcmUgYmVpbmcgcGFzc2VkIHRvIGNhbGxiYWNrcyBvZiBgb2JzZXJ2ZWAsIGBtYXBgLCBgZm9yRWFjaGAsIGBhbGxvd2AsIGFuZCBgZGVueWAuIFRyYW5zZm9ybXMgYXJlICpub3QqIGFwcGxpZWQgZm9yIHRoZSBjYWxsYmFja3Mgb2YgYG9ic2VydmVDaGFuZ2VzYCBvciB0byBjdXJzb3JzIHJldHVybmVkIGZyb20gcHVibGlzaCBmdW5jdGlvbnMuXG4gKiBAcGFyYW0ge0Jvb2xlYW59IG9wdGlvbnMuZGVmaW5lTXV0YXRpb25NZXRob2RzIFNldCB0byBgZmFsc2VgIHRvIHNraXAgc2V0dGluZyB1cCB0aGUgbXV0YXRpb24gbWV0aG9kcyB0aGF0IGVuYWJsZSBpbnNlcnQvdXBkYXRlL3JlbW92ZSBmcm9tIGNsaWVudCBjb2RlLiBEZWZhdWx0IGB0cnVlYC5cbiAqL1xuTW9uZ28uQ29sbGVjdGlvbiA9IGZ1bmN0aW9uIENvbGxlY3Rpb24obmFtZSwgb3B0aW9ucykge1xuICBpZiAoIW5hbWUgJiYgKG5hbWUgIT09IG51bGwpKSB7XG4gICAgTWV0ZW9yLl9kZWJ1ZyhcIldhcm5pbmc6IGNyZWF0aW5nIGFub255bW91cyBjb2xsZWN0aW9uLiBJdCB3aWxsIG5vdCBiZSBcIiArXG4gICAgICAgICAgICAgICAgICBcInNhdmVkIG9yIHN5bmNocm9uaXplZCBvdmVyIHRoZSBuZXR3b3JrLiAoUGFzcyBudWxsIGZvciBcIiArXG4gICAgICAgICAgICAgICAgICBcInRoZSBjb2xsZWN0aW9uIG5hbWUgdG8gdHVybiBvZmYgdGhpcyB3YXJuaW5nLilcIik7XG4gICAgbmFtZSA9IG51bGw7XG4gIH1cblxuICBpZiAobmFtZSAhPT0gbnVsbCAmJiB0eXBlb2YgbmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiRmlyc3QgYXJndW1lbnQgdG8gbmV3IE1vbmdvLkNvbGxlY3Rpb24gbXVzdCBiZSBhIHN0cmluZyBvciBudWxsXCIpO1xuICB9XG5cbiAgaWYgKG9wdGlvbnMgJiYgb3B0aW9ucy5tZXRob2RzKSB7XG4gICAgLy8gQmFja3dhcmRzIGNvbXBhdGliaWxpdHkgaGFjayB3aXRoIG9yaWdpbmFsIHNpZ25hdHVyZSAod2hpY2ggcGFzc2VkXG4gICAgLy8gXCJjb25uZWN0aW9uXCIgZGlyZWN0bHkgaW5zdGVhZCBvZiBpbiBvcHRpb25zLiAoQ29ubmVjdGlvbnMgbXVzdCBoYXZlIGEgXCJtZXRob2RzXCJcbiAgICAvLyBtZXRob2QuKVxuICAgIC8vIFhYWCByZW1vdmUgYmVmb3JlIDEuMFxuICAgIG9wdGlvbnMgPSB7Y29ubmVjdGlvbjogb3B0aW9uc307XG4gIH1cbiAgLy8gQmFja3dhcmRzIGNvbXBhdGliaWxpdHk6IFwiY29ubmVjdGlvblwiIHVzZWQgdG8gYmUgY2FsbGVkIFwibWFuYWdlclwiLlxuICBpZiAob3B0aW9ucyAmJiBvcHRpb25zLm1hbmFnZXIgJiYgIW9wdGlvbnMuY29ubmVjdGlvbikge1xuICAgIG9wdGlvbnMuY29ubmVjdGlvbiA9IG9wdGlvbnMubWFuYWdlcjtcbiAgfVxuXG4gIG9wdGlvbnMgPSB7XG4gICAgY29ubmVjdGlvbjogdW5kZWZpbmVkLFxuICAgIGlkR2VuZXJhdGlvbjogJ1NUUklORycsXG4gICAgdHJhbnNmb3JtOiBudWxsLFxuICAgIF9kcml2ZXI6IHVuZGVmaW5lZCxcbiAgICBfcHJldmVudEF1dG9wdWJsaXNoOiBmYWxzZSxcbiAgICAgIC4uLm9wdGlvbnMsXG4gIH07XG5cbiAgc3dpdGNoIChvcHRpb25zLmlkR2VuZXJhdGlvbikge1xuICBjYXNlICdNT05HTyc6XG4gICAgdGhpcy5fbWFrZU5ld0lEID0gZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIHNyYyA9IG5hbWUgPyBERFAucmFuZG9tU3RyZWFtKCcvY29sbGVjdGlvbi8nICsgbmFtZSkgOiBSYW5kb20uaW5zZWN1cmU7XG4gICAgICByZXR1cm4gbmV3IE1vbmdvLk9iamVjdElEKHNyYy5oZXhTdHJpbmcoMjQpKTtcbiAgICB9O1xuICAgIGJyZWFrO1xuICBjYXNlICdTVFJJTkcnOlxuICBkZWZhdWx0OlxuICAgIHRoaXMuX21ha2VOZXdJRCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIHZhciBzcmMgPSBuYW1lID8gRERQLnJhbmRvbVN0cmVhbSgnL2NvbGxlY3Rpb24vJyArIG5hbWUpIDogUmFuZG9tLmluc2VjdXJlO1xuICAgICAgcmV0dXJuIHNyYy5pZCgpO1xuICAgIH07XG4gICAgYnJlYWs7XG4gIH1cblxuICB0aGlzLl90cmFuc2Zvcm0gPSBMb2NhbENvbGxlY3Rpb24ud3JhcFRyYW5zZm9ybShvcHRpb25zLnRyYW5zZm9ybSk7XG5cbiAgaWYgKCEgbmFtZSB8fCBvcHRpb25zLmNvbm5lY3Rpb24gPT09IG51bGwpXG4gICAgLy8gbm90ZTogbmFtZWxlc3MgY29sbGVjdGlvbnMgbmV2ZXIgaGF2ZSBhIGNvbm5lY3Rpb25cbiAgICB0aGlzLl9jb25uZWN0aW9uID0gbnVsbDtcbiAgZWxzZSBpZiAob3B0aW9ucy5jb25uZWN0aW9uKVxuICAgIHRoaXMuX2Nvbm5lY3Rpb24gPSBvcHRpb25zLmNvbm5lY3Rpb247XG4gIGVsc2UgaWYgKE1ldGVvci5pc0NsaWVudClcbiAgICB0aGlzLl9jb25uZWN0aW9uID0gTWV0ZW9yLmNvbm5lY3Rpb247XG4gIGVsc2VcbiAgICB0aGlzLl9jb25uZWN0aW9uID0gTWV0ZW9yLnNlcnZlcjtcblxuICBpZiAoIW9wdGlvbnMuX2RyaXZlcikge1xuICAgIC8vIFhYWCBUaGlzIGNoZWNrIGFzc3VtZXMgdGhhdCB3ZWJhcHAgaXMgbG9hZGVkIHNvIHRoYXQgTWV0ZW9yLnNlcnZlciAhPT1cbiAgICAvLyBudWxsLiBXZSBzaG91bGQgZnVsbHkgc3VwcG9ydCB0aGUgY2FzZSBvZiBcIndhbnQgdG8gdXNlIGEgTW9uZ28tYmFja2VkXG4gICAgLy8gY29sbGVjdGlvbiBmcm9tIE5vZGUgY29kZSB3aXRob3V0IHdlYmFwcFwiLCBidXQgd2UgZG9uJ3QgeWV0LlxuICAgIC8vICNNZXRlb3JTZXJ2ZXJOdWxsXG4gICAgaWYgKG5hbWUgJiYgdGhpcy5fY29ubmVjdGlvbiA9PT0gTWV0ZW9yLnNlcnZlciAmJlxuICAgICAgICB0eXBlb2YgTW9uZ29JbnRlcm5hbHMgIT09IFwidW5kZWZpbmVkXCIgJiZcbiAgICAgICAgTW9uZ29JbnRlcm5hbHMuZGVmYXVsdFJlbW90ZUNvbGxlY3Rpb25Ecml2ZXIpIHtcbiAgICAgIG9wdGlvbnMuX2RyaXZlciA9IE1vbmdvSW50ZXJuYWxzLmRlZmF1bHRSZW1vdGVDb2xsZWN0aW9uRHJpdmVyKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHsgTG9jYWxDb2xsZWN0aW9uRHJpdmVyIH0gPVxuICAgICAgICByZXF1aXJlKFwiLi9sb2NhbF9jb2xsZWN0aW9uX2RyaXZlci5qc1wiKTtcbiAgICAgIG9wdGlvbnMuX2RyaXZlciA9IExvY2FsQ29sbGVjdGlvbkRyaXZlcjtcbiAgICB9XG4gIH1cblxuICB0aGlzLl9jb2xsZWN0aW9uID0gb3B0aW9ucy5fZHJpdmVyLm9wZW4obmFtZSwgdGhpcy5fY29ubmVjdGlvbik7XG4gIHRoaXMuX25hbWUgPSBuYW1lO1xuICB0aGlzLl9kcml2ZXIgPSBvcHRpb25zLl9kcml2ZXI7XG5cbiAgdGhpcy5fbWF5YmVTZXRVcFJlcGxpY2F0aW9uKG5hbWUsIG9wdGlvbnMpO1xuXG4gIC8vIFhYWCBkb24ndCBkZWZpbmUgdGhlc2UgdW50aWwgYWxsb3cgb3IgZGVueSBpcyBhY3R1YWxseSB1c2VkIGZvciB0aGlzXG4gIC8vIGNvbGxlY3Rpb24uIENvdWxkIGJlIGhhcmQgaWYgdGhlIHNlY3VyaXR5IHJ1bGVzIGFyZSBvbmx5IGRlZmluZWQgb24gdGhlXG4gIC8vIHNlcnZlci5cbiAgaWYgKG9wdGlvbnMuZGVmaW5lTXV0YXRpb25NZXRob2RzICE9PSBmYWxzZSkge1xuICAgIHRyeSB7XG4gICAgICB0aGlzLl9kZWZpbmVNdXRhdGlvbk1ldGhvZHMoe1xuICAgICAgICB1c2VFeGlzdGluZzogb3B0aW9ucy5fc3VwcHJlc3NTYW1lTmFtZUVycm9yID09PSB0cnVlXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gVGhyb3cgYSBtb3JlIHVuZGVyc3RhbmRhYmxlIGVycm9yIG9uIHRoZSBzZXJ2ZXIgZm9yIHNhbWUgY29sbGVjdGlvbiBuYW1lXG4gICAgICBpZiAoZXJyb3IubWVzc2FnZSA9PT0gYEEgbWV0aG9kIG5hbWVkICcvJHtuYW1lfS9pbnNlcnQnIGlzIGFscmVhZHkgZGVmaW5lZGApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVGhlcmUgaXMgYWxyZWFkeSBhIGNvbGxlY3Rpb24gbmFtZWQgXCIke25hbWV9XCJgKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8vIGF1dG9wdWJsaXNoXG4gIGlmIChQYWNrYWdlLmF1dG9wdWJsaXNoICYmXG4gICAgICAhIG9wdGlvbnMuX3ByZXZlbnRBdXRvcHVibGlzaCAmJlxuICAgICAgdGhpcy5fY29ubmVjdGlvbiAmJlxuICAgICAgdGhpcy5fY29ubmVjdGlvbi5wdWJsaXNoKSB7XG4gICAgdGhpcy5fY29ubmVjdGlvbi5wdWJsaXNoKG51bGwsICgpID0+IHRoaXMuZmluZCgpLCB7XG4gICAgICBpc19hdXRvOiB0cnVlLFxuICAgIH0pO1xuICB9XG59O1xuXG5PYmplY3QuYXNzaWduKE1vbmdvLkNvbGxlY3Rpb24ucHJvdG90eXBlLCB7XG4gIF9tYXliZVNldFVwUmVwbGljYXRpb24obmFtZSwge1xuICAgIF9zdXBwcmVzc1NhbWVOYW1lRXJyb3IgPSBmYWxzZVxuICB9KSB7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgaWYgKCEgKHNlbGYuX2Nvbm5lY3Rpb24gJiZcbiAgICAgICAgICAgc2VsZi5fY29ubmVjdGlvbi5yZWdpc3RlclN0b3JlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIE9LLCB3ZSdyZSBnb2luZyB0byBiZSBhIHNsYXZlLCByZXBsaWNhdGluZyBzb21lIHJlbW90ZVxuICAgIC8vIGRhdGFiYXNlLCBleGNlcHQgcG9zc2libHkgd2l0aCBzb21lIHRlbXBvcmFyeSBkaXZlcmdlbmNlIHdoaWxlXG4gICAgLy8gd2UgaGF2ZSB1bmFja25vd2xlZGdlZCBSUEMncy5cbiAgICBjb25zdCBvayA9IHNlbGYuX2Nvbm5lY3Rpb24ucmVnaXN0ZXJTdG9yZShuYW1lLCB7XG4gICAgICAvLyBDYWxsZWQgYXQgdGhlIGJlZ2lubmluZyBvZiBhIGJhdGNoIG9mIHVwZGF0ZXMuIGJhdGNoU2l6ZSBpcyB0aGUgbnVtYmVyXG4gICAgICAvLyBvZiB1cGRhdGUgY2FsbHMgdG8gZXhwZWN0LlxuICAgICAgLy9cbiAgICAgIC8vIFhYWCBUaGlzIGludGVyZmFjZSBpcyBwcmV0dHkgamFua3kuIHJlc2V0IHByb2JhYmx5IG91Z2h0IHRvIGdvIGJhY2sgdG9cbiAgICAgIC8vIGJlaW5nIGl0cyBvd24gZnVuY3Rpb24sIGFuZCBjYWxsZXJzIHNob3VsZG4ndCBoYXZlIHRvIGNhbGN1bGF0ZVxuICAgICAgLy8gYmF0Y2hTaXplLiBUaGUgb3B0aW1pemF0aW9uIG9mIG5vdCBjYWxsaW5nIHBhdXNlL3JlbW92ZSBzaG91bGQgYmVcbiAgICAgIC8vIGRlbGF5ZWQgdW50aWwgbGF0ZXI6IHRoZSBmaXJzdCBjYWxsIHRvIHVwZGF0ZSgpIHNob3VsZCBidWZmZXIgaXRzXG4gICAgICAvLyBtZXNzYWdlLCBhbmQgdGhlbiB3ZSBjYW4gZWl0aGVyIGRpcmVjdGx5IGFwcGx5IGl0IGF0IGVuZFVwZGF0ZSB0aW1lIGlmXG4gICAgICAvLyBpdCB3YXMgdGhlIG9ubHkgdXBkYXRlLCBvciBkbyBwYXVzZU9ic2VydmVycy9hcHBseS9hcHBseSBhdCB0aGUgbmV4dFxuICAgICAgLy8gdXBkYXRlKCkgaWYgdGhlcmUncyBhbm90aGVyIG9uZS5cbiAgICAgIGJlZ2luVXBkYXRlKGJhdGNoU2l6ZSwgcmVzZXQpIHtcbiAgICAgICAgLy8gcGF1c2Ugb2JzZXJ2ZXJzIHNvIHVzZXJzIGRvbid0IHNlZSBmbGlja2VyIHdoZW4gdXBkYXRpbmcgc2V2ZXJhbFxuICAgICAgICAvLyBvYmplY3RzIGF0IG9uY2UgKGluY2x1ZGluZyB0aGUgcG9zdC1yZWNvbm5lY3QgcmVzZXQtYW5kLXJlYXBwbHlcbiAgICAgICAgLy8gc3RhZ2UpLCBhbmQgc28gdGhhdCBhIHJlLXNvcnRpbmcgb2YgYSBxdWVyeSBjYW4gdGFrZSBhZHZhbnRhZ2Ugb2YgdGhlXG4gICAgICAgIC8vIGZ1bGwgX2RpZmZRdWVyeSBtb3ZlZCBjYWxjdWxhdGlvbiBpbnN0ZWFkIG9mIGFwcGx5aW5nIGNoYW5nZSBvbmUgYXQgYVxuICAgICAgICAvLyB0aW1lLlxuICAgICAgICBpZiAoYmF0Y2hTaXplID4gMSB8fCByZXNldClcbiAgICAgICAgICBzZWxmLl9jb2xsZWN0aW9uLnBhdXNlT2JzZXJ2ZXJzKCk7XG5cbiAgICAgICAgaWYgKHJlc2V0KVxuICAgICAgICAgIHNlbGYuX2NvbGxlY3Rpb24ucmVtb3ZlKHt9KTtcbiAgICAgIH0sXG5cbiAgICAgIC8vIEFwcGx5IGFuIHVwZGF0ZS5cbiAgICAgIC8vIFhYWCBiZXR0ZXIgc3BlY2lmeSB0aGlzIGludGVyZmFjZSAobm90IGluIHRlcm1zIG9mIGEgd2lyZSBtZXNzYWdlKT9cbiAgICAgIHVwZGF0ZShtc2cpIHtcbiAgICAgICAgdmFyIG1vbmdvSWQgPSBNb25nb0lELmlkUGFyc2UobXNnLmlkKTtcbiAgICAgICAgdmFyIGRvYyA9IHNlbGYuX2NvbGxlY3Rpb24uZmluZE9uZShtb25nb0lkKTtcblxuICAgICAgICAvLyBJcyB0aGlzIGEgXCJyZXBsYWNlIHRoZSB3aG9sZSBkb2NcIiBtZXNzYWdlIGNvbWluZyBmcm9tIHRoZSBxdWllc2NlbmNlXG4gICAgICAgIC8vIG9mIG1ldGhvZCB3cml0ZXMgdG8gYW4gb2JqZWN0PyAoTm90ZSB0aGF0ICd1bmRlZmluZWQnIGlzIGEgdmFsaWRcbiAgICAgICAgLy8gdmFsdWUgbWVhbmluZyBcInJlbW92ZSBpdFwiLilcbiAgICAgICAgaWYgKG1zZy5tc2cgPT09ICdyZXBsYWNlJykge1xuICAgICAgICAgIHZhciByZXBsYWNlID0gbXNnLnJlcGxhY2U7XG4gICAgICAgICAgaWYgKCFyZXBsYWNlKSB7XG4gICAgICAgICAgICBpZiAoZG9jKVxuICAgICAgICAgICAgICBzZWxmLl9jb2xsZWN0aW9uLnJlbW92ZShtb25nb0lkKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKCFkb2MpIHtcbiAgICAgICAgICAgIHNlbGYuX2NvbGxlY3Rpb24uaW5zZXJ0KHJlcGxhY2UpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBYWFggY2hlY2sgdGhhdCByZXBsYWNlIGhhcyBubyAkIG9wc1xuICAgICAgICAgICAgc2VsZi5fY29sbGVjdGlvbi51cGRhdGUobW9uZ29JZCwgcmVwbGFjZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfSBlbHNlIGlmIChtc2cubXNnID09PSAnYWRkZWQnKSB7XG4gICAgICAgICAgaWYgKGRvYykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgbm90IHRvIGZpbmQgYSBkb2N1bWVudCBhbHJlYWR5IHByZXNlbnQgZm9yIGFuIGFkZFwiKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgc2VsZi5fY29sbGVjdGlvbi5pbnNlcnQoeyBfaWQ6IG1vbmdvSWQsIC4uLm1zZy5maWVsZHMgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAobXNnLm1zZyA9PT0gJ3JlbW92ZWQnKSB7XG4gICAgICAgICAgaWYgKCFkb2MpXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCB0byBmaW5kIGEgZG9jdW1lbnQgYWxyZWFkeSBwcmVzZW50IGZvciByZW1vdmVkXCIpO1xuICAgICAgICAgIHNlbGYuX2NvbGxlY3Rpb24ucmVtb3ZlKG1vbmdvSWQpO1xuICAgICAgICB9IGVsc2UgaWYgKG1zZy5tc2cgPT09ICdjaGFuZ2VkJykge1xuICAgICAgICAgIGlmICghZG9jKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgdG8gZmluZCBhIGRvY3VtZW50IHRvIGNoYW5nZVwiKTtcbiAgICAgICAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMobXNnLmZpZWxkcyk7XG4gICAgICAgICAgaWYgKGtleXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdmFyIG1vZGlmaWVyID0ge307XG4gICAgICAgICAgICBrZXlzLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBtc2cuZmllbGRzW2tleV07XG4gICAgICAgICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIW1vZGlmaWVyLiR1bnNldCkge1xuICAgICAgICAgICAgICAgICAgbW9kaWZpZXIuJHVuc2V0ID0ge307XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG1vZGlmaWVyLiR1bnNldFtrZXldID0gMTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZiAoIW1vZGlmaWVyLiRzZXQpIHtcbiAgICAgICAgICAgICAgICAgIG1vZGlmaWVyLiRzZXQgPSB7fTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbW9kaWZpZXIuJHNldFtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgc2VsZi5fY29sbGVjdGlvbi51cGRhdGUobW9uZ29JZCwgbW9kaWZpZXIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJIGRvbid0IGtub3cgaG93IHRvIGRlYWwgd2l0aCB0aGlzIG1lc3NhZ2VcIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIC8vIENhbGxlZCBhdCB0aGUgZW5kIG9mIGEgYmF0Y2ggb2YgdXBkYXRlcy5cbiAgICAgIGVuZFVwZGF0ZSgpIHtcbiAgICAgICAgc2VsZi5fY29sbGVjdGlvbi5yZXN1bWVPYnNlcnZlcnMoKTtcbiAgICAgIH0sXG5cbiAgICAgIC8vIENhbGxlZCBhcm91bmQgbWV0aG9kIHN0dWIgaW52b2NhdGlvbnMgdG8gY2FwdHVyZSB0aGUgb3JpZ2luYWwgdmVyc2lvbnNcbiAgICAgIC8vIG9mIG1vZGlmaWVkIGRvY3VtZW50cy5cbiAgICAgIHNhdmVPcmlnaW5hbHMoKSB7XG4gICAgICAgIHNlbGYuX2NvbGxlY3Rpb24uc2F2ZU9yaWdpbmFscygpO1xuICAgICAgfSxcbiAgICAgIHJldHJpZXZlT3JpZ2luYWxzKCkge1xuICAgICAgICByZXR1cm4gc2VsZi5fY29sbGVjdGlvbi5yZXRyaWV2ZU9yaWdpbmFscygpO1xuICAgICAgfSxcblxuICAgICAgLy8gVXNlZCB0byBwcmVzZXJ2ZSBjdXJyZW50IHZlcnNpb25zIG9mIGRvY3VtZW50cyBhY3Jvc3MgYSBzdG9yZSByZXNldC5cbiAgICAgIGdldERvYyhpZCkge1xuICAgICAgICByZXR1cm4gc2VsZi5maW5kT25lKGlkKTtcbiAgICAgIH0sXG5cbiAgICAgIC8vIFRvIGJlIGFibGUgdG8gZ2V0IGJhY2sgdG8gdGhlIGNvbGxlY3Rpb24gZnJvbSB0aGUgc3RvcmUuXG4gICAgICBfZ2V0Q29sbGVjdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHNlbGY7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpZiAoISBvaykge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGBUaGVyZSBpcyBhbHJlYWR5IGEgY29sbGVjdGlvbiBuYW1lZCBcIiR7bmFtZX1cImA7XG4gICAgICBpZiAoX3N1cHByZXNzU2FtZU5hbWVFcnJvciA9PT0gdHJ1ZSkge1xuICAgICAgICAvLyBYWFggSW4gdGhlb3J5IHdlIGRvIG5vdCBoYXZlIHRvIHRocm93IHdoZW4gYG9rYCBpcyBmYWxzeS4gVGhlXG4gICAgICAgIC8vIHN0b3JlIGlzIGFscmVhZHkgZGVmaW5lZCBmb3IgdGhpcyBjb2xsZWN0aW9uIG5hbWUsIGJ1dCB0aGlzXG4gICAgICAgIC8vIHdpbGwgc2ltcGx5IGJlIGFub3RoZXIgcmVmZXJlbmNlIHRvIGl0IGFuZCBldmVyeXRoaW5nIHNob3VsZFxuICAgICAgICAvLyB3b3JrLiBIb3dldmVyLCB3ZSBoYXZlIGhpc3RvcmljYWxseSB0aHJvd24gYW4gZXJyb3IgaGVyZSwgc29cbiAgICAgICAgLy8gZm9yIG5vdyB3ZSB3aWxsIHNraXAgdGhlIGVycm9yIG9ubHkgd2hlbiBfc3VwcHJlc3NTYW1lTmFtZUVycm9yXG4gICAgICAgIC8vIGlzIGB0cnVlYCwgYWxsb3dpbmcgcGVvcGxlIHRvIG9wdCBpbiBhbmQgZ2l2ZSB0aGlzIHNvbWUgcmVhbFxuICAgICAgICAvLyB3b3JsZCB0ZXN0aW5nLlxuICAgICAgICBjb25zb2xlLndhcm4gPyBjb25zb2xlLndhcm4obWVzc2FnZSkgOiBjb25zb2xlLmxvZyhtZXNzYWdlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgLy8vXG4gIC8vLyBNYWluIGNvbGxlY3Rpb24gQVBJXG4gIC8vL1xuXG4gIF9nZXRGaW5kU2VsZWN0b3IoYXJncykge1xuICAgIGlmIChhcmdzLmxlbmd0aCA9PSAwKVxuICAgICAgcmV0dXJuIHt9O1xuICAgIGVsc2VcbiAgICAgIHJldHVybiBhcmdzWzBdO1xuICB9LFxuXG4gIF9nZXRGaW5kT3B0aW9ucyhhcmdzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChhcmdzLmxlbmd0aCA8IDIpIHtcbiAgICAgIHJldHVybiB7IHRyYW5zZm9ybTogc2VsZi5fdHJhbnNmb3JtIH07XG4gICAgfSBlbHNlIHtcbiAgICAgIGNoZWNrKGFyZ3NbMV0sIE1hdGNoLk9wdGlvbmFsKE1hdGNoLk9iamVjdEluY2x1ZGluZyh7XG4gICAgICAgIGZpZWxkczogTWF0Y2guT3B0aW9uYWwoTWF0Y2guT25lT2YoT2JqZWN0LCB1bmRlZmluZWQpKSxcbiAgICAgICAgc29ydDogTWF0Y2guT3B0aW9uYWwoTWF0Y2guT25lT2YoT2JqZWN0LCBBcnJheSwgRnVuY3Rpb24sIHVuZGVmaW5lZCkpLFxuICAgICAgICBsaW1pdDogTWF0Y2guT3B0aW9uYWwoTWF0Y2guT25lT2YoTnVtYmVyLCB1bmRlZmluZWQpKSxcbiAgICAgICAgc2tpcDogTWF0Y2guT3B0aW9uYWwoTWF0Y2guT25lT2YoTnVtYmVyLCB1bmRlZmluZWQpKVxuICAgICAgfSkpKTtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdHJhbnNmb3JtOiBzZWxmLl90cmFuc2Zvcm0sXG4gICAgICAgIC4uLmFyZ3NbMV0sXG4gICAgICB9O1xuICAgIH1cbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgRmluZCB0aGUgZG9jdW1lbnRzIGluIGEgY29sbGVjdGlvbiB0aGF0IG1hdGNoIHRoZSBzZWxlY3Rvci5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgZmluZFxuICAgKiBAbWVtYmVyT2YgTW9uZ28uQ29sbGVjdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICogQHBhcmFtIHtNb25nb1NlbGVjdG9yfSBbc2VsZWN0b3JdIEEgcXVlcnkgZGVzY3JpYmluZyB0aGUgZG9jdW1lbnRzIHRvIGZpbmRcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXVxuICAgKiBAcGFyYW0ge01vbmdvU29ydFNwZWNpZmllcn0gb3B0aW9ucy5zb3J0IFNvcnQgb3JkZXIgKGRlZmF1bHQ6IG5hdHVyYWwgb3JkZXIpXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLnNraXAgTnVtYmVyIG9mIHJlc3VsdHMgdG8gc2tpcCBhdCB0aGUgYmVnaW5uaW5nXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLmxpbWl0IE1heGltdW0gbnVtYmVyIG9mIHJlc3VsdHMgdG8gcmV0dXJuXG4gICAqIEBwYXJhbSB7TW9uZ29GaWVsZFNwZWNpZmllcn0gb3B0aW9ucy5maWVsZHMgRGljdGlvbmFyeSBvZiBmaWVsZHMgdG8gcmV0dXJuIG9yIGV4Y2x1ZGUuXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gb3B0aW9ucy5yZWFjdGl2ZSAoQ2xpZW50IG9ubHkpIERlZmF1bHQgYHRydWVgOyBwYXNzIGBmYWxzZWAgdG8gZGlzYWJsZSByZWFjdGl2aXR5XG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IG9wdGlvbnMudHJhbnNmb3JtIE92ZXJyaWRlcyBgdHJhbnNmb3JtYCBvbiB0aGUgIFtgQ29sbGVjdGlvbmBdKCNjb2xsZWN0aW9ucykgZm9yIHRoaXMgY3Vyc29yLiAgUGFzcyBgbnVsbGAgdG8gZGlzYWJsZSB0cmFuc2Zvcm1hdGlvbi5cbiAgICogQHBhcmFtIHtCb29sZWFufSBvcHRpb25zLmRpc2FibGVPcGxvZyAoU2VydmVyIG9ubHkpIFBhc3MgdHJ1ZSB0byBkaXNhYmxlIG9wbG9nLXRhaWxpbmcgb24gdGhpcyBxdWVyeS4gVGhpcyBhZmZlY3RzIHRoZSB3YXkgc2VydmVyIHByb2Nlc3NlcyBjYWxscyB0byBgb2JzZXJ2ZWAgb24gdGhpcyBxdWVyeS4gRGlzYWJsaW5nIHRoZSBvcGxvZyBjYW4gYmUgdXNlZnVsIHdoZW4gd29ya2luZyB3aXRoIGRhdGEgdGhhdCB1cGRhdGVzIGluIGxhcmdlIGJhdGNoZXMuXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLnBvbGxpbmdJbnRlcnZhbE1zIChTZXJ2ZXIgb25seSkgV2hlbiBvcGxvZyBpcyBkaXNhYmxlZCAodGhyb3VnaCB0aGUgdXNlIG9mIGBkaXNhYmxlT3Bsb2dgIG9yIHdoZW4gb3RoZXJ3aXNlIG5vdCBhdmFpbGFibGUpLCB0aGUgZnJlcXVlbmN5IChpbiBtaWxsaXNlY29uZHMpIG9mIGhvdyBvZnRlbiB0byBwb2xsIHRoaXMgcXVlcnkgd2hlbiBvYnNlcnZpbmcgb24gdGhlIHNlcnZlci4gRGVmYXVsdHMgdG8gMTAwMDBtcyAoMTAgc2Vjb25kcykuXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLnBvbGxpbmdUaHJvdHRsZU1zIChTZXJ2ZXIgb25seSkgV2hlbiBvcGxvZyBpcyBkaXNhYmxlZCAodGhyb3VnaCB0aGUgdXNlIG9mIGBkaXNhYmxlT3Bsb2dgIG9yIHdoZW4gb3RoZXJ3aXNlIG5vdCBhdmFpbGFibGUpLCB0aGUgbWluaW11bSB0aW1lIChpbiBtaWxsaXNlY29uZHMpIHRvIGFsbG93IGJldHdlZW4gcmUtcG9sbGluZyB3aGVuIG9ic2VydmluZyBvbiB0aGUgc2VydmVyLiBJbmNyZWFzaW5nIHRoaXMgd2lsbCBzYXZlIENQVSBhbmQgbW9uZ28gbG9hZCBhdCB0aGUgZXhwZW5zZSBvZiBzbG93ZXIgdXBkYXRlcyB0byB1c2Vycy4gRGVjcmVhc2luZyB0aGlzIGlzIG5vdCByZWNvbW1lbmRlZC4gRGVmYXVsdHMgdG8gNTBtcy5cbiAgICogQHBhcmFtIHtOdW1iZXJ9IG9wdGlvbnMubWF4VGltZU1zIChTZXJ2ZXIgb25seSkgSWYgc2V0LCBpbnN0cnVjdHMgTW9uZ29EQiB0byBzZXQgYSB0aW1lIGxpbWl0IGZvciB0aGlzIGN1cnNvcidzIG9wZXJhdGlvbnMuIElmIHRoZSBvcGVyYXRpb24gcmVhY2hlcyB0aGUgc3BlY2lmaWVkIHRpbWUgbGltaXQgKGluIG1pbGxpc2Vjb25kcykgd2l0aG91dCB0aGUgaGF2aW5nIGJlZW4gY29tcGxldGVkLCBhbiBleGNlcHRpb24gd2lsbCBiZSB0aHJvd24uIFVzZWZ1bCB0byBwcmV2ZW50IGFuIChhY2NpZGVudGFsIG9yIG1hbGljaW91cykgdW5vcHRpbWl6ZWQgcXVlcnkgZnJvbSBjYXVzaW5nIGEgZnVsbCBjb2xsZWN0aW9uIHNjYW4gdGhhdCB3b3VsZCBkaXNydXB0IG90aGVyIGRhdGFiYXNlIHVzZXJzLCBhdCB0aGUgZXhwZW5zZSBvZiBuZWVkaW5nIHRvIGhhbmRsZSB0aGUgcmVzdWx0aW5nIGVycm9yLlxuICAgKiBAcGFyYW0ge1N0cmluZ3xPYmplY3R9IG9wdGlvbnMuaGludCAoU2VydmVyIG9ubHkpIE92ZXJyaWRlcyBNb25nb0RCJ3MgZGVmYXVsdCBpbmRleCBzZWxlY3Rpb24gYW5kIHF1ZXJ5IG9wdGltaXphdGlvbiBwcm9jZXNzLiBTcGVjaWZ5IGFuIGluZGV4IHRvIGZvcmNlIGl0cyB1c2UsIGVpdGhlciBieSBpdHMgbmFtZSBvciBpbmRleCBzcGVjaWZpY2F0aW9uLiBZb3UgY2FuIGFsc28gc3BlY2lmeSBgeyAkbmF0dXJhbCA6IDEgfWAgdG8gZm9yY2UgYSBmb3J3YXJkcyBjb2xsZWN0aW9uIHNjYW4sIG9yIGB7ICRuYXR1cmFsIDogLTEgfWAgZm9yIGEgcmV2ZXJzZSBjb2xsZWN0aW9uIHNjYW4uIFNldHRpbmcgdGhpcyBpcyBvbmx5IHJlY29tbWVuZGVkIGZvciBhZHZhbmNlZCB1c2Vycy5cbiAgICogQHJldHVybnMge01vbmdvLkN1cnNvcn1cbiAgICovXG4gIGZpbmQoLi4uYXJncykge1xuICAgIC8vIENvbGxlY3Rpb24uZmluZCgpIChyZXR1cm4gYWxsIGRvY3MpIGJlaGF2ZXMgZGlmZmVyZW50bHlcbiAgICAvLyBmcm9tIENvbGxlY3Rpb24uZmluZCh1bmRlZmluZWQpIChyZXR1cm4gMCBkb2NzKS4gIHNvIGJlXG4gICAgLy8gY2FyZWZ1bCBhYm91dCB0aGUgbGVuZ3RoIG9mIGFyZ3VtZW50cy5cbiAgICByZXR1cm4gdGhpcy5fY29sbGVjdGlvbi5maW5kKFxuICAgICAgdGhpcy5fZ2V0RmluZFNlbGVjdG9yKGFyZ3MpLFxuICAgICAgdGhpcy5fZ2V0RmluZE9wdGlvbnMoYXJncylcbiAgICApO1xuICB9LFxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBGaW5kcyB0aGUgZmlyc3QgZG9jdW1lbnQgdGhhdCBtYXRjaGVzIHRoZSBzZWxlY3RvciwgYXMgb3JkZXJlZCBieSBzb3J0IGFuZCBza2lwIG9wdGlvbnMuIFJldHVybnMgYHVuZGVmaW5lZGAgaWYgbm8gbWF0Y2hpbmcgZG9jdW1lbnQgaXMgZm91bmQuXG4gICAqIEBsb2N1cyBBbnl3aGVyZVxuICAgKiBAbWV0aG9kIGZpbmRPbmVcbiAgICogQG1lbWJlck9mIE1vbmdvLkNvbGxlY3Rpb25cbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7TW9uZ29TZWxlY3Rvcn0gW3NlbGVjdG9yXSBBIHF1ZXJ5IGRlc2NyaWJpbmcgdGhlIGRvY3VtZW50cyB0byBmaW5kXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc11cbiAgICogQHBhcmFtIHtNb25nb1NvcnRTcGVjaWZpZXJ9IG9wdGlvbnMuc29ydCBTb3J0IG9yZGVyIChkZWZhdWx0OiBuYXR1cmFsIG9yZGVyKVxuICAgKiBAcGFyYW0ge051bWJlcn0gb3B0aW9ucy5za2lwIE51bWJlciBvZiByZXN1bHRzIHRvIHNraXAgYXQgdGhlIGJlZ2lubmluZ1xuICAgKiBAcGFyYW0ge01vbmdvRmllbGRTcGVjaWZpZXJ9IG9wdGlvbnMuZmllbGRzIERpY3Rpb25hcnkgb2YgZmllbGRzIHRvIHJldHVybiBvciBleGNsdWRlLlxuICAgKiBAcGFyYW0ge0Jvb2xlYW59IG9wdGlvbnMucmVhY3RpdmUgKENsaWVudCBvbmx5KSBEZWZhdWx0IHRydWU7IHBhc3MgZmFsc2UgdG8gZGlzYWJsZSByZWFjdGl2aXR5XG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IG9wdGlvbnMudHJhbnNmb3JtIE92ZXJyaWRlcyBgdHJhbnNmb3JtYCBvbiB0aGUgW2BDb2xsZWN0aW9uYF0oI2NvbGxlY3Rpb25zKSBmb3IgdGhpcyBjdXJzb3IuICBQYXNzIGBudWxsYCB0byBkaXNhYmxlIHRyYW5zZm9ybWF0aW9uLlxuICAgKiBAcmV0dXJucyB7T2JqZWN0fVxuICAgKi9cbiAgZmluZE9uZSguLi5hcmdzKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbGxlY3Rpb24uZmluZE9uZShcbiAgICAgIHRoaXMuX2dldEZpbmRTZWxlY3RvcihhcmdzKSxcbiAgICAgIHRoaXMuX2dldEZpbmRPcHRpb25zKGFyZ3MpXG4gICAgKTtcbiAgfVxufSk7XG5cbk9iamVjdC5hc3NpZ24oTW9uZ28uQ29sbGVjdGlvbiwge1xuICBfcHVibGlzaEN1cnNvcihjdXJzb3IsIHN1YiwgY29sbGVjdGlvbikge1xuICAgIHZhciBvYnNlcnZlSGFuZGxlID0gY3Vyc29yLm9ic2VydmVDaGFuZ2VzKHtcbiAgICAgIGFkZGVkOiBmdW5jdGlvbiAoaWQsIGZpZWxkcykge1xuICAgICAgICBzdWIuYWRkZWQoY29sbGVjdGlvbiwgaWQsIGZpZWxkcyk7XG4gICAgICB9LFxuICAgICAgY2hhbmdlZDogZnVuY3Rpb24gKGlkLCBmaWVsZHMpIHtcbiAgICAgICAgc3ViLmNoYW5nZWQoY29sbGVjdGlvbiwgaWQsIGZpZWxkcyk7XG4gICAgICB9LFxuICAgICAgcmVtb3ZlZDogZnVuY3Rpb24gKGlkKSB7XG4gICAgICAgIHN1Yi5yZW1vdmVkKGNvbGxlY3Rpb24sIGlkKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIFdlIGRvbid0IGNhbGwgc3ViLnJlYWR5KCkgaGVyZTogaXQgZ2V0cyBjYWxsZWQgaW4gbGl2ZWRhdGFfc2VydmVyLCBhZnRlclxuICAgIC8vIHBvc3NpYmx5IGNhbGxpbmcgX3B1Ymxpc2hDdXJzb3Igb24gbXVsdGlwbGUgcmV0dXJuZWQgY3Vyc29ycy5cblxuICAgIC8vIHJlZ2lzdGVyIHN0b3AgY2FsbGJhY2sgKGV4cGVjdHMgbGFtYmRhIHcvIG5vIGFyZ3MpLlxuICAgIHN1Yi5vblN0b3AoZnVuY3Rpb24gKCkge1xuICAgICAgb2JzZXJ2ZUhhbmRsZS5zdG9wKCk7XG4gICAgfSk7XG5cbiAgICAvLyByZXR1cm4gdGhlIG9ic2VydmVIYW5kbGUgaW4gY2FzZSBpdCBuZWVkcyB0byBiZSBzdG9wcGVkIGVhcmx5XG4gICAgcmV0dXJuIG9ic2VydmVIYW5kbGU7XG4gIH0sXG5cbiAgLy8gcHJvdGVjdCBhZ2FpbnN0IGRhbmdlcm91cyBzZWxlY3RvcnMuICBmYWxzZXkgYW5kIHtfaWQ6IGZhbHNleX0gYXJlIGJvdGhcbiAgLy8gbGlrZWx5IHByb2dyYW1tZXIgZXJyb3IsIGFuZCBub3Qgd2hhdCB5b3Ugd2FudCwgcGFydGljdWxhcmx5IGZvciBkZXN0cnVjdGl2ZVxuICAvLyBvcGVyYXRpb25zLiBJZiBhIGZhbHNleSBfaWQgaXMgc2VudCBpbiwgYSBuZXcgc3RyaW5nIF9pZCB3aWxsIGJlXG4gIC8vIGdlbmVyYXRlZCBhbmQgcmV0dXJuZWQ7IGlmIGEgZmFsbGJhY2tJZCBpcyBwcm92aWRlZCwgaXQgd2lsbCBiZSByZXR1cm5lZFxuICAvLyBpbnN0ZWFkLlxuICBfcmV3cml0ZVNlbGVjdG9yKHNlbGVjdG9yLCB7IGZhbGxiYWNrSWQgfSA9IHt9KSB7XG4gICAgLy8gc2hvcnRoYW5kIC0tIHNjYWxhcnMgbWF0Y2ggX2lkXG4gICAgaWYgKExvY2FsQ29sbGVjdGlvbi5fc2VsZWN0b3JJc0lkKHNlbGVjdG9yKSlcbiAgICAgIHNlbGVjdG9yID0ge19pZDogc2VsZWN0b3J9O1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoc2VsZWN0b3IpKSB7XG4gICAgICAvLyBUaGlzIGlzIGNvbnNpc3RlbnQgd2l0aCB0aGUgTW9uZ28gY29uc29sZSBpdHNlbGY7IGlmIHdlIGRvbid0IGRvIHRoaXNcbiAgICAgIC8vIGNoZWNrIHBhc3NpbmcgYW4gZW1wdHkgYXJyYXkgZW5kcyB1cCBzZWxlY3RpbmcgYWxsIGl0ZW1zXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJNb25nbyBzZWxlY3RvciBjYW4ndCBiZSBhbiBhcnJheS5cIik7XG4gICAgfVxuXG4gICAgaWYgKCFzZWxlY3RvciB8fCAoKCdfaWQnIGluIHNlbGVjdG9yKSAmJiAhc2VsZWN0b3IuX2lkKSkge1xuICAgICAgLy8gY2FuJ3QgbWF0Y2ggYW55dGhpbmdcbiAgICAgIHJldHVybiB7IF9pZDogZmFsbGJhY2tJZCB8fCBSYW5kb20uaWQoKSB9O1xuICAgIH1cblxuICAgIHJldHVybiBzZWxlY3RvcjtcbiAgfVxufSk7XG5cbk9iamVjdC5hc3NpZ24oTW9uZ28uQ29sbGVjdGlvbi5wcm90b3R5cGUsIHtcbiAgLy8gJ2luc2VydCcgaW1tZWRpYXRlbHkgcmV0dXJucyB0aGUgaW5zZXJ0ZWQgZG9jdW1lbnQncyBuZXcgX2lkLlxuICAvLyBUaGUgb3RoZXJzIHJldHVybiB2YWx1ZXMgaW1tZWRpYXRlbHkgaWYgeW91IGFyZSBpbiBhIHN0dWIsIGFuIGluLW1lbW9yeVxuICAvLyB1bm1hbmFnZWQgY29sbGVjdGlvbiwgb3IgYSBtb25nby1iYWNrZWQgY29sbGVjdGlvbiBhbmQgeW91IGRvbid0IHBhc3MgYVxuICAvLyBjYWxsYmFjay4gJ3VwZGF0ZScgYW5kICdyZW1vdmUnIHJldHVybiB0aGUgbnVtYmVyIG9mIGFmZmVjdGVkXG4gIC8vIGRvY3VtZW50cy4gJ3Vwc2VydCcgcmV0dXJucyBhbiBvYmplY3Qgd2l0aCBrZXlzICdudW1iZXJBZmZlY3RlZCcgYW5kLCBpZiBhblxuICAvLyBpbnNlcnQgaGFwcGVuZWQsICdpbnNlcnRlZElkJy5cbiAgLy9cbiAgLy8gT3RoZXJ3aXNlLCB0aGUgc2VtYW50aWNzIGFyZSBleGFjdGx5IGxpa2Ugb3RoZXIgbWV0aG9kczogdGhleSB0YWtlXG4gIC8vIGEgY2FsbGJhY2sgYXMgYW4gb3B0aW9uYWwgbGFzdCBhcmd1bWVudDsgaWYgbm8gY2FsbGJhY2sgaXNcbiAgLy8gcHJvdmlkZWQsIHRoZXkgYmxvY2sgdW50aWwgdGhlIG9wZXJhdGlvbiBpcyBjb21wbGV0ZSwgYW5kIHRocm93IGFuXG4gIC8vIGV4Y2VwdGlvbiBpZiBpdCBmYWlsczsgaWYgYSBjYWxsYmFjayBpcyBwcm92aWRlZCwgdGhlbiB0aGV5IGRvbid0XG4gIC8vIG5lY2Vzc2FyaWx5IGJsb2NrLCBhbmQgdGhleSBjYWxsIHRoZSBjYWxsYmFjayB3aGVuIHRoZXkgZmluaXNoIHdpdGggZXJyb3IgYW5kXG4gIC8vIHJlc3VsdCBhcmd1bWVudHMuICAoVGhlIGluc2VydCBtZXRob2QgcHJvdmlkZXMgdGhlIGRvY3VtZW50IElEIGFzIGl0cyByZXN1bHQ7XG4gIC8vIHVwZGF0ZSBhbmQgcmVtb3ZlIHByb3ZpZGUgdGhlIG51bWJlciBvZiBhZmZlY3RlZCBkb2NzIGFzIHRoZSByZXN1bHQ7IHVwc2VydFxuICAvLyBwcm92aWRlcyBhbiBvYmplY3Qgd2l0aCBudW1iZXJBZmZlY3RlZCBhbmQgbWF5YmUgaW5zZXJ0ZWRJZC4pXG4gIC8vXG4gIC8vIE9uIHRoZSBjbGllbnQsIGJsb2NraW5nIGlzIGltcG9zc2libGUsIHNvIGlmIGEgY2FsbGJhY2tcbiAgLy8gaXNuJ3QgcHJvdmlkZWQsIHRoZXkganVzdCByZXR1cm4gaW1tZWRpYXRlbHkgYW5kIGFueSBlcnJvclxuICAvLyBpbmZvcm1hdGlvbiBpcyBsb3N0LlxuICAvL1xuICAvLyBUaGVyZSdzIG9uZSBtb3JlIHR3ZWFrLiBPbiB0aGUgY2xpZW50LCBpZiB5b3UgZG9uJ3QgcHJvdmlkZSBhXG4gIC8vIGNhbGxiYWNrLCB0aGVuIGlmIHRoZXJlIGlzIGFuIGVycm9yLCBhIG1lc3NhZ2Ugd2lsbCBiZSBsb2dnZWQgd2l0aFxuICAvLyBNZXRlb3IuX2RlYnVnLlxuICAvL1xuICAvLyBUaGUgaW50ZW50ICh0aG91Z2ggdGhpcyBpcyBhY3R1YWxseSBkZXRlcm1pbmVkIGJ5IHRoZSB1bmRlcmx5aW5nXG4gIC8vIGRyaXZlcnMpIGlzIHRoYXQgdGhlIG9wZXJhdGlvbnMgc2hvdWxkIGJlIGRvbmUgc3luY2hyb25vdXNseSwgbm90XG4gIC8vIGdlbmVyYXRpbmcgdGhlaXIgcmVzdWx0IHVudGlsIHRoZSBkYXRhYmFzZSBoYXMgYWNrbm93bGVkZ2VkXG4gIC8vIHRoZW0uIEluIHRoZSBmdXR1cmUgbWF5YmUgd2Ugc2hvdWxkIHByb3ZpZGUgYSBmbGFnIHRvIHR1cm4gdGhpc1xuICAvLyBvZmYuXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IEluc2VydCBhIGRvY3VtZW50IGluIHRoZSBjb2xsZWN0aW9uLiAgUmV0dXJucyBpdHMgdW5pcXVlIF9pZC5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgIGluc2VydFxuICAgKiBAbWVtYmVyT2YgTW9uZ28uQ29sbGVjdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICogQHBhcmFtIHtPYmplY3R9IGRvYyBUaGUgZG9jdW1lbnQgdG8gaW5zZXJ0LiBNYXkgbm90IHlldCBoYXZlIGFuIF9pZCBhdHRyaWJ1dGUsIGluIHdoaWNoIGNhc2UgTWV0ZW9yIHdpbGwgZ2VuZXJhdGUgb25lIGZvciB5b3UuXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYWxsYmFja10gT3B0aW9uYWwuICBJZiBwcmVzZW50LCBjYWxsZWQgd2l0aCBhbiBlcnJvciBvYmplY3QgYXMgdGhlIGZpcnN0IGFyZ3VtZW50IGFuZCwgaWYgbm8gZXJyb3IsIHRoZSBfaWQgYXMgdGhlIHNlY29uZC5cbiAgICovXG4gIGluc2VydChkb2MsIGNhbGxiYWNrKSB7XG4gICAgLy8gTWFrZSBzdXJlIHdlIHdlcmUgcGFzc2VkIGEgZG9jdW1lbnQgdG8gaW5zZXJ0XG4gICAgaWYgKCFkb2MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImluc2VydCByZXF1aXJlcyBhbiBhcmd1bWVudFwiKTtcbiAgICB9XG5cbiAgICAvLyBNYWtlIGEgc2hhbGxvdyBjbG9uZSBvZiB0aGUgZG9jdW1lbnQsIHByZXNlcnZpbmcgaXRzIHByb3RvdHlwZS5cbiAgICBkb2MgPSBPYmplY3QuY3JlYXRlKFxuICAgICAgT2JqZWN0LmdldFByb3RvdHlwZU9mKGRvYyksXG4gICAgICBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9ycyhkb2MpXG4gICAgKTtcblxuICAgIGlmICgnX2lkJyBpbiBkb2MpIHtcbiAgICAgIGlmICghIGRvYy5faWQgfHxcbiAgICAgICAgICAhICh0eXBlb2YgZG9jLl9pZCA9PT0gJ3N0cmluZycgfHxcbiAgICAgICAgICAgICBkb2MuX2lkIGluc3RhbmNlb2YgTW9uZ28uT2JqZWN0SUQpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBcIk1ldGVvciByZXF1aXJlcyBkb2N1bWVudCBfaWQgZmllbGRzIHRvIGJlIG5vbi1lbXB0eSBzdHJpbmdzIG9yIE9iamVjdElEc1wiKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbGV0IGdlbmVyYXRlSWQgPSB0cnVlO1xuXG4gICAgICAvLyBEb24ndCBnZW5lcmF0ZSB0aGUgaWQgaWYgd2UncmUgdGhlIGNsaWVudCBhbmQgdGhlICdvdXRlcm1vc3QnIGNhbGxcbiAgICAgIC8vIFRoaXMgb3B0aW1pemF0aW9uIHNhdmVzIHVzIHBhc3NpbmcgYm90aCB0aGUgcmFuZG9tU2VlZCBhbmQgdGhlIGlkXG4gICAgICAvLyBQYXNzaW5nIGJvdGggaXMgcmVkdW5kYW50LlxuICAgICAgaWYgKHRoaXMuX2lzUmVtb3RlQ29sbGVjdGlvbigpKSB7XG4gICAgICAgIGNvbnN0IGVuY2xvc2luZyA9IEREUC5fQ3VycmVudE1ldGhvZEludm9jYXRpb24uZ2V0KCk7XG4gICAgICAgIGlmICghZW5jbG9zaW5nKSB7XG4gICAgICAgICAgZ2VuZXJhdGVJZCA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChnZW5lcmF0ZUlkKSB7XG4gICAgICAgIGRvYy5faWQgPSB0aGlzLl9tYWtlTmV3SUQoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBPbiBpbnNlcnRzLCBhbHdheXMgcmV0dXJuIHRoZSBpZCB0aGF0IHdlIGdlbmVyYXRlZDsgb24gYWxsIG90aGVyXG4gICAgLy8gb3BlcmF0aW9ucywganVzdCByZXR1cm4gdGhlIHJlc3VsdCBmcm9tIHRoZSBjb2xsZWN0aW9uLlxuICAgIHZhciBjaG9vc2VSZXR1cm5WYWx1ZUZyb21Db2xsZWN0aW9uUmVzdWx0ID0gZnVuY3Rpb24gKHJlc3VsdCkge1xuICAgICAgaWYgKGRvYy5faWQpIHtcbiAgICAgICAgcmV0dXJuIGRvYy5faWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIFhYWCB3aGF0IGlzIHRoaXMgZm9yPz9cbiAgICAgIC8vIEl0J3Mgc29tZSBpdGVyYWN0aW9uIGJldHdlZW4gdGhlIGNhbGxiYWNrIHRvIF9jYWxsTXV0YXRvck1ldGhvZCBhbmRcbiAgICAgIC8vIHRoZSByZXR1cm4gdmFsdWUgY29udmVyc2lvblxuICAgICAgZG9jLl9pZCA9IHJlc3VsdDtcblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xuXG4gICAgY29uc3Qgd3JhcHBlZENhbGxiYWNrID0gd3JhcENhbGxiYWNrKFxuICAgICAgY2FsbGJhY2ssIGNob29zZVJldHVyblZhbHVlRnJvbUNvbGxlY3Rpb25SZXN1bHQpO1xuXG4gICAgaWYgKHRoaXMuX2lzUmVtb3RlQ29sbGVjdGlvbigpKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSB0aGlzLl9jYWxsTXV0YXRvck1ldGhvZChcImluc2VydFwiLCBbZG9jXSwgd3JhcHBlZENhbGxiYWNrKTtcbiAgICAgIHJldHVybiBjaG9vc2VSZXR1cm5WYWx1ZUZyb21Db2xsZWN0aW9uUmVzdWx0KHJlc3VsdCk7XG4gICAgfVxuXG4gICAgLy8gaXQncyBteSBjb2xsZWN0aW9uLiAgZGVzY2VuZCBpbnRvIHRoZSBjb2xsZWN0aW9uIG9iamVjdFxuICAgIC8vIGFuZCBwcm9wYWdhdGUgYW55IGV4Y2VwdGlvbi5cbiAgICB0cnkge1xuICAgICAgLy8gSWYgdGhlIHVzZXIgcHJvdmlkZWQgYSBjYWxsYmFjayBhbmQgdGhlIGNvbGxlY3Rpb24gaW1wbGVtZW50cyB0aGlzXG4gICAgICAvLyBvcGVyYXRpb24gYXN5bmNocm9ub3VzbHksIHRoZW4gcXVlcnlSZXQgd2lsbCBiZSB1bmRlZmluZWQsIGFuZCB0aGVcbiAgICAgIC8vIHJlc3VsdCB3aWxsIGJlIHJldHVybmVkIHRocm91Z2ggdGhlIGNhbGxiYWNrIGluc3RlYWQuXG4gICAgICBjb25zdCByZXN1bHQgPSB0aGlzLl9jb2xsZWN0aW9uLmluc2VydChkb2MsIHdyYXBwZWRDYWxsYmFjayk7XG4gICAgICByZXR1cm4gY2hvb3NlUmV0dXJuVmFsdWVGcm9tQ29sbGVjdGlvblJlc3VsdChyZXN1bHQpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICBjYWxsYmFjayhlKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgTW9kaWZ5IG9uZSBvciBtb3JlIGRvY3VtZW50cyBpbiB0aGUgY29sbGVjdGlvbi4gUmV0dXJucyB0aGUgbnVtYmVyIG9mIG1hdGNoZWQgZG9jdW1lbnRzLlxuICAgKiBAbG9jdXMgQW55d2hlcmVcbiAgICogQG1ldGhvZCB1cGRhdGVcbiAgICogQG1lbWJlck9mIE1vbmdvLkNvbGxlY3Rpb25cbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7TW9uZ29TZWxlY3Rvcn0gc2VsZWN0b3IgU3BlY2lmaWVzIHdoaWNoIGRvY3VtZW50cyB0byBtb2RpZnlcbiAgICogQHBhcmFtIHtNb25nb01vZGlmaWVyfSBtb2RpZmllciBTcGVjaWZpZXMgaG93IHRvIG1vZGlmeSB0aGUgZG9jdW1lbnRzXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc11cbiAgICogQHBhcmFtIHtCb29sZWFufSBvcHRpb25zLm11bHRpIFRydWUgdG8gbW9kaWZ5IGFsbCBtYXRjaGluZyBkb2N1bWVudHM7IGZhbHNlIHRvIG9ubHkgbW9kaWZ5IG9uZSBvZiB0aGUgbWF0Y2hpbmcgZG9jdW1lbnRzICh0aGUgZGVmYXVsdCkuXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gb3B0aW9ucy51cHNlcnQgVHJ1ZSB0byBpbnNlcnQgYSBkb2N1bWVudCBpZiBubyBtYXRjaGluZyBkb2N1bWVudHMgYXJlIGZvdW5kLlxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY2FsbGJhY2tdIE9wdGlvbmFsLiAgSWYgcHJlc2VudCwgY2FsbGVkIHdpdGggYW4gZXJyb3Igb2JqZWN0IGFzIHRoZSBmaXJzdCBhcmd1bWVudCBhbmQsIGlmIG5vIGVycm9yLCB0aGUgbnVtYmVyIG9mIGFmZmVjdGVkIGRvY3VtZW50cyBhcyB0aGUgc2Vjb25kLlxuICAgKi9cbiAgdXBkYXRlKHNlbGVjdG9yLCBtb2RpZmllciwgLi4ub3B0aW9uc0FuZENhbGxiYWNrKSB7XG4gICAgY29uc3QgY2FsbGJhY2sgPSBwb3BDYWxsYmFja0Zyb21BcmdzKG9wdGlvbnNBbmRDYWxsYmFjayk7XG5cbiAgICAvLyBXZSd2ZSBhbHJlYWR5IHBvcHBlZCBvZmYgdGhlIGNhbGxiYWNrLCBzbyB3ZSBhcmUgbGVmdCB3aXRoIGFuIGFycmF5XG4gICAgLy8gb2Ygb25lIG9yIHplcm8gaXRlbXNcbiAgICBjb25zdCBvcHRpb25zID0geyAuLi4ob3B0aW9uc0FuZENhbGxiYWNrWzBdIHx8IG51bGwpIH07XG4gICAgbGV0IGluc2VydGVkSWQ7XG4gICAgaWYgKG9wdGlvbnMgJiYgb3B0aW9ucy51cHNlcnQpIHtcbiAgICAgIC8vIHNldCBgaW5zZXJ0ZWRJZGAgaWYgYWJzZW50LiAgYGluc2VydGVkSWRgIGlzIGEgTWV0ZW9yIGV4dGVuc2lvbi5cbiAgICAgIGlmIChvcHRpb25zLmluc2VydGVkSWQpIHtcbiAgICAgICAgaWYgKCEodHlwZW9mIG9wdGlvbnMuaW5zZXJ0ZWRJZCA9PT0gJ3N0cmluZycgfHwgb3B0aW9ucy5pbnNlcnRlZElkIGluc3RhbmNlb2YgTW9uZ28uT2JqZWN0SUQpKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImluc2VydGVkSWQgbXVzdCBiZSBzdHJpbmcgb3IgT2JqZWN0SURcIik7XG4gICAgICAgIGluc2VydGVkSWQgPSBvcHRpb25zLmluc2VydGVkSWQ7XG4gICAgICB9IGVsc2UgaWYgKCFzZWxlY3RvciB8fCAhc2VsZWN0b3IuX2lkKSB7XG4gICAgICAgIGluc2VydGVkSWQgPSB0aGlzLl9tYWtlTmV3SUQoKTtcbiAgICAgICAgb3B0aW9ucy5nZW5lcmF0ZWRJZCA9IHRydWU7XG4gICAgICAgIG9wdGlvbnMuaW5zZXJ0ZWRJZCA9IGluc2VydGVkSWQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgc2VsZWN0b3IgPVxuICAgICAgTW9uZ28uQ29sbGVjdGlvbi5fcmV3cml0ZVNlbGVjdG9yKHNlbGVjdG9yLCB7IGZhbGxiYWNrSWQ6IGluc2VydGVkSWQgfSk7XG5cbiAgICBjb25zdCB3cmFwcGVkQ2FsbGJhY2sgPSB3cmFwQ2FsbGJhY2soY2FsbGJhY2spO1xuXG4gICAgaWYgKHRoaXMuX2lzUmVtb3RlQ29sbGVjdGlvbigpKSB7XG4gICAgICBjb25zdCBhcmdzID0gW1xuICAgICAgICBzZWxlY3RvcixcbiAgICAgICAgbW9kaWZpZXIsXG4gICAgICAgIG9wdGlvbnNcbiAgICAgIF07XG5cbiAgICAgIHJldHVybiB0aGlzLl9jYWxsTXV0YXRvck1ldGhvZChcInVwZGF0ZVwiLCBhcmdzLCB3cmFwcGVkQ2FsbGJhY2spO1xuICAgIH1cblxuICAgIC8vIGl0J3MgbXkgY29sbGVjdGlvbi4gIGRlc2NlbmQgaW50byB0aGUgY29sbGVjdGlvbiBvYmplY3RcbiAgICAvLyBhbmQgcHJvcGFnYXRlIGFueSBleGNlcHRpb24uXG4gICAgdHJ5IHtcbiAgICAgIC8vIElmIHRoZSB1c2VyIHByb3ZpZGVkIGEgY2FsbGJhY2sgYW5kIHRoZSBjb2xsZWN0aW9uIGltcGxlbWVudHMgdGhpc1xuICAgICAgLy8gb3BlcmF0aW9uIGFzeW5jaHJvbm91c2x5LCB0aGVuIHF1ZXJ5UmV0IHdpbGwgYmUgdW5kZWZpbmVkLCBhbmQgdGhlXG4gICAgICAvLyByZXN1bHQgd2lsbCBiZSByZXR1cm5lZCB0aHJvdWdoIHRoZSBjYWxsYmFjayBpbnN0ZWFkLlxuICAgICAgcmV0dXJuIHRoaXMuX2NvbGxlY3Rpb24udXBkYXRlKFxuICAgICAgICBzZWxlY3RvciwgbW9kaWZpZXIsIG9wdGlvbnMsIHdyYXBwZWRDYWxsYmFjayk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgIGNhbGxiYWNrKGUpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9LFxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBSZW1vdmUgZG9jdW1lbnRzIGZyb20gdGhlIGNvbGxlY3Rpb25cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgcmVtb3ZlXG4gICAqIEBtZW1iZXJPZiBNb25nby5Db2xsZWN0aW9uXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAcGFyYW0ge01vbmdvU2VsZWN0b3J9IHNlbGVjdG9yIFNwZWNpZmllcyB3aGljaCBkb2N1bWVudHMgdG8gcmVtb3ZlXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYWxsYmFja10gT3B0aW9uYWwuICBJZiBwcmVzZW50LCBjYWxsZWQgd2l0aCBhbiBlcnJvciBvYmplY3QgYXMgaXRzIGFyZ3VtZW50LlxuICAgKi9cbiAgcmVtb3ZlKHNlbGVjdG9yLCBjYWxsYmFjaykge1xuICAgIHNlbGVjdG9yID0gTW9uZ28uQ29sbGVjdGlvbi5fcmV3cml0ZVNlbGVjdG9yKHNlbGVjdG9yKTtcblxuICAgIGNvbnN0IHdyYXBwZWRDYWxsYmFjayA9IHdyYXBDYWxsYmFjayhjYWxsYmFjayk7XG5cbiAgICBpZiAodGhpcy5faXNSZW1vdGVDb2xsZWN0aW9uKCkpIHtcbiAgICAgIHJldHVybiB0aGlzLl9jYWxsTXV0YXRvck1ldGhvZChcInJlbW92ZVwiLCBbc2VsZWN0b3JdLCB3cmFwcGVkQ2FsbGJhY2spO1xuICAgIH1cblxuICAgIC8vIGl0J3MgbXkgY29sbGVjdGlvbi4gIGRlc2NlbmQgaW50byB0aGUgY29sbGVjdGlvbiBvYmplY3RcbiAgICAvLyBhbmQgcHJvcGFnYXRlIGFueSBleGNlcHRpb24uXG4gICAgdHJ5IHtcbiAgICAgIC8vIElmIHRoZSB1c2VyIHByb3ZpZGVkIGEgY2FsbGJhY2sgYW5kIHRoZSBjb2xsZWN0aW9uIGltcGxlbWVudHMgdGhpc1xuICAgICAgLy8gb3BlcmF0aW9uIGFzeW5jaHJvbm91c2x5LCB0aGVuIHF1ZXJ5UmV0IHdpbGwgYmUgdW5kZWZpbmVkLCBhbmQgdGhlXG4gICAgICAvLyByZXN1bHQgd2lsbCBiZSByZXR1cm5lZCB0aHJvdWdoIHRoZSBjYWxsYmFjayBpbnN0ZWFkLlxuICAgICAgcmV0dXJuIHRoaXMuX2NvbGxlY3Rpb24ucmVtb3ZlKHNlbGVjdG9yLCB3cmFwcGVkQ2FsbGJhY2spO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICBjYWxsYmFjayhlKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfSxcblxuICAvLyBEZXRlcm1pbmUgaWYgdGhpcyBjb2xsZWN0aW9uIGlzIHNpbXBseSBhIG1pbmltb25nbyByZXByZXNlbnRhdGlvbiBvZiBhIHJlYWxcbiAgLy8gZGF0YWJhc2Ugb24gYW5vdGhlciBzZXJ2ZXJcbiAgX2lzUmVtb3RlQ29sbGVjdGlvbigpIHtcbiAgICAvLyBYWFggc2VlICNNZXRlb3JTZXJ2ZXJOdWxsXG4gICAgcmV0dXJuIHRoaXMuX2Nvbm5lY3Rpb24gJiYgdGhpcy5fY29ubmVjdGlvbiAhPT0gTWV0ZW9yLnNlcnZlcjtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgTW9kaWZ5IG9uZSBvciBtb3JlIGRvY3VtZW50cyBpbiB0aGUgY29sbGVjdGlvbiwgb3IgaW5zZXJ0IG9uZSBpZiBubyBtYXRjaGluZyBkb2N1bWVudHMgd2VyZSBmb3VuZC4gUmV0dXJucyBhbiBvYmplY3Qgd2l0aCBrZXlzIGBudW1iZXJBZmZlY3RlZGAgKHRoZSBudW1iZXIgb2YgZG9jdW1lbnRzIG1vZGlmaWVkKSAgYW5kIGBpbnNlcnRlZElkYCAodGhlIHVuaXF1ZSBfaWQgb2YgdGhlIGRvY3VtZW50IHRoYXQgd2FzIGluc2VydGVkLCBpZiBhbnkpLlxuICAgKiBAbG9jdXMgQW55d2hlcmVcbiAgICogQHBhcmFtIHtNb25nb1NlbGVjdG9yfSBzZWxlY3RvciBTcGVjaWZpZXMgd2hpY2ggZG9jdW1lbnRzIHRvIG1vZGlmeVxuICAgKiBAcGFyYW0ge01vbmdvTW9kaWZpZXJ9IG1vZGlmaWVyIFNwZWNpZmllcyBob3cgdG8gbW9kaWZ5IHRoZSBkb2N1bWVudHNcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXVxuICAgKiBAcGFyYW0ge0Jvb2xlYW59IG9wdGlvbnMubXVsdGkgVHJ1ZSB0byBtb2RpZnkgYWxsIG1hdGNoaW5nIGRvY3VtZW50czsgZmFsc2UgdG8gb25seSBtb2RpZnkgb25lIG9mIHRoZSBtYXRjaGluZyBkb2N1bWVudHMgKHRoZSBkZWZhdWx0KS5cbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gW2NhbGxiYWNrXSBPcHRpb25hbC4gIElmIHByZXNlbnQsIGNhbGxlZCB3aXRoIGFuIGVycm9yIG9iamVjdCBhcyB0aGUgZmlyc3QgYXJndW1lbnQgYW5kLCBpZiBubyBlcnJvciwgdGhlIG51bWJlciBvZiBhZmZlY3RlZCBkb2N1bWVudHMgYXMgdGhlIHNlY29uZC5cbiAgICovXG4gIHVwc2VydChzZWxlY3RvciwgbW9kaWZpZXIsIG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCEgY2FsbGJhY2sgJiYgdHlwZW9mIG9wdGlvbnMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgY2FsbGJhY2sgPSBvcHRpb25zO1xuICAgICAgb3B0aW9ucyA9IHt9O1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnVwZGF0ZShzZWxlY3RvciwgbW9kaWZpZXIsIHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICBfcmV0dXJuT2JqZWN0OiB0cnVlLFxuICAgICAgdXBzZXJ0OiB0cnVlLFxuICAgIH0sIGNhbGxiYWNrKTtcbiAgfSxcblxuICAvLyBXZSdsbCBhY3R1YWxseSBkZXNpZ24gYW4gaW5kZXggQVBJIGxhdGVyLiBGb3Igbm93LCB3ZSBqdXN0IHBhc3MgdGhyb3VnaCB0b1xuICAvLyBNb25nbydzLCBidXQgbWFrZSBpdCBzeW5jaHJvbm91cy5cbiAgX2Vuc3VyZUluZGV4KGluZGV4LCBvcHRpb25zKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmICghc2VsZi5fY29sbGVjdGlvbi5fZW5zdXJlSW5kZXgpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4gb25seSBjYWxsIF9lbnN1cmVJbmRleCBvbiBzZXJ2ZXIgY29sbGVjdGlvbnNcIik7XG4gICAgc2VsZi5fY29sbGVjdGlvbi5fZW5zdXJlSW5kZXgoaW5kZXgsIG9wdGlvbnMpO1xuICB9LFxuXG4gIF9kcm9wSW5kZXgoaW5kZXgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKCFzZWxmLl9jb2xsZWN0aW9uLl9kcm9wSW5kZXgpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4gb25seSBjYWxsIF9kcm9wSW5kZXggb24gc2VydmVyIGNvbGxlY3Rpb25zXCIpO1xuICAgIHNlbGYuX2NvbGxlY3Rpb24uX2Ryb3BJbmRleChpbmRleCk7XG4gIH0sXG5cbiAgX2Ryb3BDb2xsZWN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoIXNlbGYuX2NvbGxlY3Rpb24uZHJvcENvbGxlY3Rpb24pXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4gb25seSBjYWxsIF9kcm9wQ29sbGVjdGlvbiBvbiBzZXJ2ZXIgY29sbGVjdGlvbnNcIik7XG4gICAgc2VsZi5fY29sbGVjdGlvbi5kcm9wQ29sbGVjdGlvbigpO1xuICB9LFxuXG4gIF9jcmVhdGVDYXBwZWRDb2xsZWN0aW9uKGJ5dGVTaXplLCBtYXhEb2N1bWVudHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKCFzZWxmLl9jb2xsZWN0aW9uLl9jcmVhdGVDYXBwZWRDb2xsZWN0aW9uKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FuIG9ubHkgY2FsbCBfY3JlYXRlQ2FwcGVkQ29sbGVjdGlvbiBvbiBzZXJ2ZXIgY29sbGVjdGlvbnNcIik7XG4gICAgc2VsZi5fY29sbGVjdGlvbi5fY3JlYXRlQ2FwcGVkQ29sbGVjdGlvbihieXRlU2l6ZSwgbWF4RG9jdW1lbnRzKTtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgUmV0dXJucyB0aGUgW2BDb2xsZWN0aW9uYF0oaHR0cDovL21vbmdvZGIuZ2l0aHViLmlvL25vZGUtbW9uZ29kYi1uYXRpdmUvMi4yL2FwaS9Db2xsZWN0aW9uLmh0bWwpIG9iamVjdCBjb3JyZXNwb25kaW5nIHRvIHRoaXMgY29sbGVjdGlvbiBmcm9tIHRoZSBbbnBtIGBtb25nb2RiYCBkcml2ZXIgbW9kdWxlXShodHRwczovL3d3dy5ucG1qcy5jb20vcGFja2FnZS9tb25nb2RiKSB3aGljaCBpcyB3cmFwcGVkIGJ5IGBNb25nby5Db2xsZWN0aW9uYC5cbiAgICogQGxvY3VzIFNlcnZlclxuICAgKi9cbiAgcmF3Q29sbGVjdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKCEgc2VsZi5fY29sbGVjdGlvbi5yYXdDb2xsZWN0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4gb25seSBjYWxsIHJhd0NvbGxlY3Rpb24gb24gc2VydmVyIGNvbGxlY3Rpb25zXCIpO1xuICAgIH1cbiAgICByZXR1cm4gc2VsZi5fY29sbGVjdGlvbi5yYXdDb2xsZWN0aW9uKCk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IFJldHVybnMgdGhlIFtgRGJgXShodHRwOi8vbW9uZ29kYi5naXRodWIuaW8vbm9kZS1tb25nb2RiLW5hdGl2ZS8yLjIvYXBpL0RiLmh0bWwpIG9iamVjdCBjb3JyZXNwb25kaW5nIHRvIHRoaXMgY29sbGVjdGlvbidzIGRhdGFiYXNlIGNvbm5lY3Rpb24gZnJvbSB0aGUgW25wbSBgbW9uZ29kYmAgZHJpdmVyIG1vZHVsZV0oaHR0cHM6Ly93d3cubnBtanMuY29tL3BhY2thZ2UvbW9uZ29kYikgd2hpY2ggaXMgd3JhcHBlZCBieSBgTW9uZ28uQ29sbGVjdGlvbmAuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICovXG4gIHJhd0RhdGFiYXNlKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoISAoc2VsZi5fZHJpdmVyLm1vbmdvICYmIHNlbGYuX2RyaXZlci5tb25nby5kYikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbiBvbmx5IGNhbGwgcmF3RGF0YWJhc2Ugb24gc2VydmVyIGNvbGxlY3Rpb25zXCIpO1xuICAgIH1cbiAgICByZXR1cm4gc2VsZi5fZHJpdmVyLm1vbmdvLmRiO1xuICB9XG59KTtcblxuLy8gQ29udmVydCB0aGUgY2FsbGJhY2sgdG8gbm90IHJldHVybiBhIHJlc3VsdCBpZiB0aGVyZSBpcyBhbiBlcnJvclxuZnVuY3Rpb24gd3JhcENhbGxiYWNrKGNhbGxiYWNrLCBjb252ZXJ0UmVzdWx0KSB7XG4gIHJldHVybiBjYWxsYmFjayAmJiBmdW5jdGlvbiAoZXJyb3IsIHJlc3VsdCkge1xuICAgIGlmIChlcnJvcikge1xuICAgICAgY2FsbGJhY2soZXJyb3IpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGNvbnZlcnRSZXN1bHQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgY2FsbGJhY2sobnVsbCwgY29udmVydFJlc3VsdChyZXN1bHQpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzdWx0KTtcbiAgICB9XG4gIH07XG59XG5cbi8qKlxuICogQHN1bW1hcnkgQ3JlYXRlIGEgTW9uZ28tc3R5bGUgYE9iamVjdElEYC4gIElmIHlvdSBkb24ndCBzcGVjaWZ5IGEgYGhleFN0cmluZ2AsIHRoZSBgT2JqZWN0SURgIHdpbGwgZ2VuZXJhdGVkIHJhbmRvbWx5IChub3QgdXNpbmcgTW9uZ29EQidzIElEIGNvbnN0cnVjdGlvbiBydWxlcykuXG4gKiBAbG9jdXMgQW55d2hlcmVcbiAqIEBjbGFzc1xuICogQHBhcmFtIHtTdHJpbmd9IFtoZXhTdHJpbmddIE9wdGlvbmFsLiAgVGhlIDI0LWNoYXJhY3RlciBoZXhhZGVjaW1hbCBjb250ZW50cyBvZiB0aGUgT2JqZWN0SUQgdG8gY3JlYXRlXG4gKi9cbk1vbmdvLk9iamVjdElEID0gTW9uZ29JRC5PYmplY3RJRDtcblxuLyoqXG4gKiBAc3VtbWFyeSBUbyBjcmVhdGUgYSBjdXJzb3IsIHVzZSBmaW5kLiBUbyBhY2Nlc3MgdGhlIGRvY3VtZW50cyBpbiBhIGN1cnNvciwgdXNlIGZvckVhY2gsIG1hcCwgb3IgZmV0Y2guXG4gKiBAY2xhc3NcbiAqIEBpbnN0YW5jZU5hbWUgY3Vyc29yXG4gKi9cbk1vbmdvLkN1cnNvciA9IExvY2FsQ29sbGVjdGlvbi5DdXJzb3I7XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgaW4gMC45LjFcbiAqL1xuTW9uZ28uQ29sbGVjdGlvbi5DdXJzb3IgPSBNb25nby5DdXJzb3I7XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgaW4gMC45LjFcbiAqL1xuTW9uZ28uQ29sbGVjdGlvbi5PYmplY3RJRCA9IE1vbmdvLk9iamVjdElEO1xuXG4vKipcbiAqIEBkZXByZWNhdGVkIGluIDAuOS4xXG4gKi9cbk1ldGVvci5Db2xsZWN0aW9uID0gTW9uZ28uQ29sbGVjdGlvbjtcblxuLy8gQWxsb3cgZGVueSBzdHVmZiBpcyBub3cgaW4gdGhlIGFsbG93LWRlbnkgcGFja2FnZVxuT2JqZWN0LmFzc2lnbihcbiAgTWV0ZW9yLkNvbGxlY3Rpb24ucHJvdG90eXBlLFxuICBBbGxvd0RlbnkuQ29sbGVjdGlvblByb3RvdHlwZVxuKTtcblxuZnVuY3Rpb24gcG9wQ2FsbGJhY2tGcm9tQXJncyhhcmdzKSB7XG4gIC8vIFB1bGwgb2ZmIGFueSBjYWxsYmFjayAob3IgcGVyaGFwcyBhICdjYWxsYmFjaycgdmFyaWFibGUgdGhhdCB3YXMgcGFzc2VkXG4gIC8vIGluIHVuZGVmaW5lZCwgbGlrZSBob3cgJ3Vwc2VydCcgZG9lcyBpdCkuXG4gIGlmIChhcmdzLmxlbmd0aCAmJlxuICAgICAgKGFyZ3NbYXJncy5sZW5ndGggLSAxXSA9PT0gdW5kZWZpbmVkIHx8XG4gICAgICAgYXJnc1thcmdzLmxlbmd0aCAtIDFdIGluc3RhbmNlb2YgRnVuY3Rpb24pKSB7XG4gICAgcmV0dXJuIGFyZ3MucG9wKCk7XG4gIH1cbn1cbiIsIi8qKlxuICogQHN1bW1hcnkgQWxsb3dzIGZvciB1c2VyIHNwZWNpZmllZCBjb25uZWN0aW9uIG9wdGlvbnNcbiAqIEBleGFtcGxlIGh0dHA6Ly9tb25nb2RiLmdpdGh1Yi5pby9ub2RlLW1vbmdvZGItbmF0aXZlLzIuMi9yZWZlcmVuY2UvY29ubmVjdGluZy9jb25uZWN0aW9uLXNldHRpbmdzL1xuICogQGxvY3VzIFNlcnZlclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgVXNlciBzcGVjaWZpZWQgTW9uZ28gY29ubmVjdGlvbiBvcHRpb25zXG4gKi9cbk1vbmdvLnNldENvbm5lY3Rpb25PcHRpb25zID0gZnVuY3Rpb24gc2V0Q29ubmVjdGlvbk9wdGlvbnMgKG9wdGlvbnMpIHtcbiAgY2hlY2sob3B0aW9ucywgT2JqZWN0KTtcbiAgTW9uZ28uX2Nvbm5lY3Rpb25PcHRpb25zID0gb3B0aW9ucztcbn07Il19
