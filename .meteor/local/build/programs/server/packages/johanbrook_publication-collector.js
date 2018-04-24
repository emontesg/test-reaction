(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var ECMAScript = Package.ecmascript.ECMAScript;
var _ = Package.underscore._;
var MongoInternals = Package.mongo.MongoInternals;
var Mongo = Package.mongo.Mongo;
var check = Package.check.check;
var Match = Package.check.Match;
var meteorInstall = Package.modules.meteorInstall;
var meteorBabelHelpers = Package['babel-runtime'].meteorBabelHelpers;
var Promise = Package.promise.Promise;

var require = meteorInstall({"node_modules":{"meteor":{"johanbrook:publication-collector":{"publication-collector.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/johanbrook_publication-collector/publication-collector.js                                                  //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  PublicationCollector: () => PublicationCollector
});
let Meteor;
module.watch(require("meteor/meteor"), {
  Meteor(v) {
    Meteor = v;
  }

}, 0);
let Match, check;
module.watch(require("meteor/check"), {
  Match(v) {
    Match = v;
  },

  check(v) {
    check = v;
  }

}, 1);
let Mongo;
module.watch(require("meteor/mongo"), {
  Mongo(v) {
    Mongo = v;
  }

}, 2);
let MongoID;
module.watch(require("meteor/mongo-id"), {
  MongoID(v) {
    MongoID = v;
  }

}, 3);
let EventEmitter;
module.watch(require("events"), {
  EventEmitter(v) {
    EventEmitter = v;
  }

}, 4);
const validMongoId = Match.OneOf(String, Mongo.ObjectID);
/*
  This class describes something like Subscription in
  meteor/meteor/packages/ddp/livedata_server.js, but instead of sending
  over a socket it just collects data.
*/

class PublicationCollector extends EventEmitter {
  constructor(opts = {}) {
    super();
    check(opts.userId, Match.Optional(String));
    check(opts.delayInMs, Match.Optional(Match.Integer)); // Object where the keys are collection names, and then the keys are _ids

    this._documents = {};

    this.unblock = () => {};

    this.userId = opts.userId;
    this._idFilter = {
      idStringify: MongoID.idStringify,
      idParse: MongoID.idParse
    };

    this._isDeactivated = () => {};

    this.delayInMs = opts.delayInMs;
  }

  collect(name, ...args) {
    let callback; // extracts optional callback from latest argument

    if (_.isFunction(args[args.length - 1])) {
      callback = args.pop();
    }

    const handler = Meteor.server.publish_handlers[name];

    if (!handler) {
      throw new Error(`PublicationCollector: Couldn't find publication "${name}"! Did you misspell it?`);
    }

    return new Promise((resolve, reject) => {
      const done = (...res) => {
        callback && callback(...res);
        resolve(...res);
      };

      const completeCollecting = collections => {
        try {
          done(collections);
        } finally {
          // stop the subscription
          this.stop();
        }
      }; // adds a one time listener function for the "ready" event


      this.once('ready', collections => {
        if (this.delayInMs) {
          Meteor.setTimeout(() => {
            // collections is out of date, so we need to regenerate
            collections = this._generateResponse();
            completeCollecting(collections);
          }, this.delayInMs);
        } else {
          // immediately complete
          completeCollecting(collections);
        }
      });
      const result = handler.call(this, ...args);

      this._publishHandlerResult(result);
    });
  }
  /**
   * Reproduces "_publishHandlerResult" processing
   * @see {@link https://github.com/meteor/meteor/blob/master/packages/ddp-server/livedata_server.js#L1045}
   */


  _publishHandlerResult(res) {
    const cursors = []; // publication handlers can return a collection cursor, an array of cursors or nothing.

    if (this._isCursor(res)) {
      cursors.push(res);
    } else if (Array.isArray(res)) {
      // check all the elements are cursors
      const areCursors = res.reduce((valid, cur) => valid && this._isCursor(cur), true);

      if (!areCursors) {
        this.error(new Error('PublicationCollector: Publish function returned an array of non-Cursors'));
        return;
      } // find duplicate collection names


      const collectionNames = {};

      for (let i = 0; i < res.length; ++i) {
        const collectionName = res[i]._getCollectionName();

        if ({}.hasOwnProperty.call(collectionNames, collectionName)) {
          this.error(new Error(`PublicationCollector: Publish function returned multiple cursors for collection ${collectionName}`));
          return;
        }

        collectionNames[collectionName] = true;
        cursors.push(res[i]);
      }
    } else if (res) {
      // truthy values other than cursors or arrays are probably a
      // user mistake (possible returning a Mongo document via, say,
      // `coll.findOne()`).
      this.error(new Error('PublicationCollector: Publish function can only return a Cursor or an array of Cursors'));
    }

    if (cursors.length > 0) {
      try {
        // for each cursor we call _publishCursor method which starts observing the cursor and
        // publishes the results.
        cursors.forEach(cur => {
          this._ensureCollectionInRes(cur._getCollectionName());

          cur._publishCursor(this);
        });
      } catch (e) {
        this.error(e);
        return;
      } // mark subscription as ready (_publishCursor does NOT call ready())


      this.ready();
    }
  }

  added(collection, id, fields) {
    check(collection, String);
    check(id, validMongoId);

    this._ensureCollectionInRes(collection); // Make sure to ignore the _id in fields


    const addedDocument = _.extend({
      _id: id
    }, _.omit(fields, '_id'));

    this._documents[collection][id] = addedDocument;
  }

  changed(collection, id, fields) {
    check(collection, String);
    check(id, validMongoId);

    this._ensureCollectionInRes(collection);

    const existingDocument = this._documents[collection][id];

    const fieldsNoId = _.omit(fields, '_id');

    if (existingDocument) {
      _.extend(existingDocument, fieldsNoId); // Delete all keys that were undefined in fields (except _id)


      _.forEach(fields, (value, key) => {
        if (value === undefined) {
          delete existingDocument[key];
        }
      });
    }
  }

  removed(collection, id) {
    check(collection, String);
    check(id, validMongoId);

    this._ensureCollectionInRes(collection);

    delete this._documents[collection][id];

    if (_.isEmpty(this._documents[collection])) {
      delete this._documents[collection];
    }
  }

  ready() {
    // Synchronously calls each of the listeners registered for the "ready" event
    this.emit('ready', this._generateResponse());
  }

  onStop(callback) {
    // Adds a one time listener function for the "stop" event
    this.once('stop', callback);
  }

  stop() {
    // Synchronously calls each of the listeners registered for the "stop" event
    this.emit('stop');
  }

  error(error) {
    throw error;
  }

  _isCursor(c) {
    return c && c._publishCursor;
  }

  _ensureCollectionInRes(collection) {
    this._documents[collection] = this._documents[collection] || {};
  }

  _generateResponse() {
    const output = {};

    _.forEach(this._documents, (documents, collectionName) => {
      output[collectionName] = _.values(documents);
    });

    return output;
  }

}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});
var exports = require("/node_modules/meteor/johanbrook:publication-collector/publication-collector.js");

/* Exports */
Package._define("johanbrook:publication-collector", exports);

})();

//# sourceURL=meteor://💻app/packages/johanbrook_publication-collector.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvam9oYW5icm9vazpwdWJsaWNhdGlvbi1jb2xsZWN0b3IvcHVibGljYXRpb24tY29sbGVjdG9yLmpzIl0sIm5hbWVzIjpbIm1vZHVsZSIsImV4cG9ydCIsIlB1YmxpY2F0aW9uQ29sbGVjdG9yIiwiTWV0ZW9yIiwid2F0Y2giLCJyZXF1aXJlIiwidiIsIk1hdGNoIiwiY2hlY2siLCJNb25nbyIsIk1vbmdvSUQiLCJFdmVudEVtaXR0ZXIiLCJ2YWxpZE1vbmdvSWQiLCJPbmVPZiIsIlN0cmluZyIsIk9iamVjdElEIiwiY29uc3RydWN0b3IiLCJvcHRzIiwidXNlcklkIiwiT3B0aW9uYWwiLCJkZWxheUluTXMiLCJJbnRlZ2VyIiwiX2RvY3VtZW50cyIsInVuYmxvY2siLCJfaWRGaWx0ZXIiLCJpZFN0cmluZ2lmeSIsImlkUGFyc2UiLCJfaXNEZWFjdGl2YXRlZCIsImNvbGxlY3QiLCJuYW1lIiwiYXJncyIsImNhbGxiYWNrIiwiXyIsImlzRnVuY3Rpb24iLCJsZW5ndGgiLCJwb3AiLCJoYW5kbGVyIiwic2VydmVyIiwicHVibGlzaF9oYW5kbGVycyIsIkVycm9yIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJkb25lIiwicmVzIiwiY29tcGxldGVDb2xsZWN0aW5nIiwiY29sbGVjdGlvbnMiLCJzdG9wIiwib25jZSIsInNldFRpbWVvdXQiLCJfZ2VuZXJhdGVSZXNwb25zZSIsInJlc3VsdCIsImNhbGwiLCJfcHVibGlzaEhhbmRsZXJSZXN1bHQiLCJjdXJzb3JzIiwiX2lzQ3Vyc29yIiwicHVzaCIsIkFycmF5IiwiaXNBcnJheSIsImFyZUN1cnNvcnMiLCJyZWR1Y2UiLCJ2YWxpZCIsImN1ciIsImVycm9yIiwiY29sbGVjdGlvbk5hbWVzIiwiaSIsImNvbGxlY3Rpb25OYW1lIiwiX2dldENvbGxlY3Rpb25OYW1lIiwiaGFzT3duUHJvcGVydHkiLCJmb3JFYWNoIiwiX2Vuc3VyZUNvbGxlY3Rpb25JblJlcyIsIl9wdWJsaXNoQ3Vyc29yIiwiZSIsInJlYWR5IiwiYWRkZWQiLCJjb2xsZWN0aW9uIiwiaWQiLCJmaWVsZHMiLCJhZGRlZERvY3VtZW50IiwiZXh0ZW5kIiwiX2lkIiwib21pdCIsImNoYW5nZWQiLCJleGlzdGluZ0RvY3VtZW50IiwiZmllbGRzTm9JZCIsInZhbHVlIiwia2V5IiwidW5kZWZpbmVkIiwicmVtb3ZlZCIsImlzRW1wdHkiLCJlbWl0Iiwib25TdG9wIiwiYyIsIm91dHB1dCIsImRvY3VtZW50cyIsInZhbHVlcyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUFBLE9BQU9DLE1BQVAsQ0FBYztBQUFDQyx3QkFBcUIsTUFBSUE7QUFBMUIsQ0FBZDtBQUErRCxJQUFJQyxNQUFKO0FBQVdILE9BQU9JLEtBQVAsQ0FBYUMsUUFBUSxlQUFSLENBQWIsRUFBc0M7QUFBQ0YsU0FBT0csQ0FBUCxFQUFTO0FBQUNILGFBQU9HLENBQVA7QUFBUzs7QUFBcEIsQ0FBdEMsRUFBNEQsQ0FBNUQ7QUFBK0QsSUFBSUMsS0FBSixFQUFVQyxLQUFWO0FBQWdCUixPQUFPSSxLQUFQLENBQWFDLFFBQVEsY0FBUixDQUFiLEVBQXFDO0FBQUNFLFFBQU1ELENBQU4sRUFBUTtBQUFDQyxZQUFNRCxDQUFOO0FBQVEsR0FBbEI7O0FBQW1CRSxRQUFNRixDQUFOLEVBQVE7QUFBQ0UsWUFBTUYsQ0FBTjtBQUFROztBQUFwQyxDQUFyQyxFQUEyRSxDQUEzRTtBQUE4RSxJQUFJRyxLQUFKO0FBQVVULE9BQU9JLEtBQVAsQ0FBYUMsUUFBUSxjQUFSLENBQWIsRUFBcUM7QUFBQ0ksUUFBTUgsQ0FBTixFQUFRO0FBQUNHLFlBQU1ILENBQU47QUFBUTs7QUFBbEIsQ0FBckMsRUFBeUQsQ0FBekQ7QUFBNEQsSUFBSUksT0FBSjtBQUFZVixPQUFPSSxLQUFQLENBQWFDLFFBQVEsaUJBQVIsQ0FBYixFQUF3QztBQUFDSyxVQUFRSixDQUFSLEVBQVU7QUFBQ0ksY0FBUUosQ0FBUjtBQUFVOztBQUF0QixD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U0FBRCxFQUFZNUIsY0FBWixLQUErQjtBQUN4RDJCLGFBQU8zQixjQUFQLElBQXlCbEMsRUFBRStELE1BQUYsQ0FBU0QsU0FBVCxDQUF6QjtBQUNELEtBRkQ7O0FBSUEsV0FBT0QsTUFBUDtBQUNEOztBQTVNb0QsQyIsImZpbGUiOiIvcGFja2FnZXMvam9oYW5icm9va19wdWJsaWNhdGlvbi1jb2xsZWN0b3IuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBNZXRlb3IgfSBmcm9tICdtZXRlb3IvbWV0ZW9yJztcbmltcG9ydCB7IE1hdGNoLCBjaGVjayB9IGZyb20gJ21ldGVvci9jaGVjayc7XG5pbXBvcnQgeyBNb25nbyB9IGZyb20gJ21ldGVvci9tb25nbyc7XG5pbXBvcnQgeyBNb25nb0lEIH0gZnJvbSAnbWV0ZW9yL21vbmdvLWlkJztcbmltcG9ydCB7IEV2ZW50RW1pdHRlciB9IGZyb20gJ2V2ZW50cyc7XG5cbmNvbnN0IHZhbGlkTW9uZ29JZCA9IE1hdGNoLk9uZU9mKFN0cmluZywgTW9uZ28uT2JqZWN0SUQpO1xuXG4vKlxuICBUaGlzIGNsYXNzIGRlc2NyaWJlcyBzb21ldGhpbmcgbGlrZSBTdWJzY3JpcHRpb24gaW5cbiAgbWV0ZW9yL21ldGVvci9wYWNrYWdlcy9kZHAvbGl2ZWRhdGFfc2VydmVyLmpzLCBidXQgaW5zdGVhZCBvZiBzZW5kaW5nXG4gIG92ZXIgYSBzb2NrZXQgaXQganVzdCBjb2xsZWN0cyBkYXRhLlxuKi9cbmV4cG9ydCBjbGFzcyBQdWJsaWNhdGlvbkNvbGxlY3RvciBleHRlbmRzIEV2ZW50RW1pdHRlciB7XG5cbiAgY29uc3RydWN0b3Iob3B0cyA9IHt9KSB7XG4gICAgc3VwZXIoKTtcbiAgICBjaGVjayhvcHRzLnVzZXJJZCwgTWF0Y2guT3B0aW9uYWwoU3RyaW5nKSk7XG4gICAgY2hlY2sob3B0cy5kZWxheUluTXMsIE1hdGNoLk9wdGlvbmFsKE1hdGNoLkludGVnZXIpKTtcblxuICAgIC8vIE9iamVjdCB3aGVyZSB0aGUga2V5cyBhcmUgY29sbGVjdGlvbiBuYW1lcywgYW5kIHRoZW4gdGhlIGtleXMgYXJlIF9pZHNcbiAgICB0aGlzLl9kb2N1bWVudHMgPSB7fTtcbiAgICB0aGlzLnVuYmxvY2sgPSAoKSA9PiB7fTtcbiAgICB0aGlzLnVzZXJJZCA9IG9wdHMudXNlcklkO1xuICAgIHRoaXMuX2lkRmlsdGVyID0ge1xuICAgICAgaWRTdHJpbmdpZnk6IE1vbmdvSUQuaWRTdHJpbmdpZnksXG4gICAgICBpZFBhcnNlOiBNb25nb0lELmlkUGFyc2VcbiAgICB9O1xuICAgIHRoaXMuX2lzRGVhY3RpdmF0ZWQgPSAoKSA9PiB7fTtcblxuICAgIHRoaXMuZGVsYXlJbk1zID0gb3B0cy5kZWxheUluTXM7XG4gIH1cblxuICBjb2xsZWN0KG5hbWUsIC4uLmFyZ3MpIHtcbiAgICBsZXQgY2FsbGJhY2s7XG4gICAgLy8gZXh0cmFjdHMgb3B0aW9uYWwgY2FsbGJhY2sgZnJvbSBsYXRlc3QgYXJndW1lbnRcbiAgICBpZiAoXy5pc0Z1bmN0aW9uKGFyZ3NbYXJncy5sZW5ndGggLSAxXSkpIHtcbiAgICAgIGNhbGxiYWNrID0gYXJncy5wb3AoKTtcbiAgICB9XG5cbiAgICBjb25zdCBoYW5kbGVyID0gTWV0ZW9yLnNlcnZlci5wdWJsaXNoX2hhbmRsZXJzW25hbWVdO1xuXG4gICAgaWYgKCFoYW5kbGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFB1YmxpY2F0aW9uQ29sbGVjdG9yOiBDb3VsZG4ndCBmaW5kIHB1YmxpY2F0aW9uIFwiJHtuYW1lfVwiISBEaWQgeW91IG1pc3NwZWxsIGl0P2ApO1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cbiAgICAgIGNvbnN0IGRvbmUgPSAoLi4ucmVzKSA9PiB7XG4gICAgICAgIGNhbGxiYWNrICYmIGNhbGxiYWNrKC4uLnJlcyk7XG4gICAgICAgIHJlc29sdmUoLi4ucmVzKTtcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbXBsZXRlQ29sbGVjdGluZyA9IChjb2xsZWN0aW9ucykgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGRvbmUoY29sbGVjdGlvbnMpO1xuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIC8vIHN0b3AgdGhlIHN1YnNjcmlwdGlvblxuICAgICAgICAgIHRoaXMuc3RvcCgpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICAvLyBhZGRzIGEgb25lIHRpbWUgbGlzdGVuZXIgZnVuY3Rpb24gZm9yIHRoZSBcInJlYWR5XCIgZXZlbnRcbiAgICAgIHRoaXMub25jZSgncmVhZHknLCAoY29sbGVjdGlvbnMpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuZGVsYXlJbk1zKSB7XG4gICAgICAgICAgTWV0ZW9yLnNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgLy8gY29sbGVjdGlvbnMgaXMgb3V0IG9mIGRhdGUsIHNvIHdlIG5lZWQgdG8gcmVnZW5lcmF0ZVxuICAgICAgICAgICAgY29sbGVjdGlvbnMgPSB0aGlzLl9nZW5lcmF0ZVJlc3BvbnNlKCk7XG4gICAgICAgICAgICBjb21wbGV0ZUNvbGxlY3RpbmcoY29sbGVjdGlvbnMpO1xuICAgICAgICAgIH0sIHRoaXMuZGVsYXlJbk1zKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBpbW1lZGlhdGVseSBjb21wbGV0ZVxuICAgICAgICAgIGNvbXBsZXRlQ29sbGVjdGluZyhjb2xsZWN0aW9ucyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBoYW5kbGVyLmNhbGwodGhpcywgLi4uYXJncyk7XG5cbiAgICAgIHRoaXMuX3B1Ymxpc2hIYW5kbGVyUmVzdWx0KHJlc3VsdCk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVwcm9kdWNlcyBcIl9wdWJsaXNoSGFuZGxlclJlc3VsdFwiIHByb2Nlc3NpbmdcbiAgICogQHNlZSB7QGxpbmsgaHR0cHM6Ly9naXRodWIuY29tL21ldGVvci9tZXRlb3IvYmxvYi9tYXN0ZXIvcGFja2FnZXMvZGRwLXNlcnZlci9saXZlZGF0YV9zZXJ2ZXIuanMjTDEwNDV9XG4gICAqL1xuICBfcHVibGlzaEhhbmRsZXJSZXN1bHQocmVzKSB7XG4gICAgY29uc3QgY3Vyc29ycyA9IFtdO1xuXG4gICAgLy8gcHVibGljYXRpb24gaGFuZGxlcnMgY2FuIHJldHVybiBhIGNvbGxlY3Rpb24gY3Vyc29yLCBhbiBhcnJheSBvZiBjdXJzb3JzIG9yIG5vdGhpbmcuXG4gICAgaWYgKHRoaXMuX2lzQ3Vyc29yKHJlcykpIHtcbiAgICAgIGN1cnNvcnMucHVzaChyZXMpO1xuICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShyZXMpKSB7XG4gICAgICAvLyBjaGVjayBhbGwgdGhlIGVsZW1lbnRzIGFyZSBjdXJzb3JzXG4gICAgICBjb25zdCBhcmVDdXJzb3JzID0gcmVzLnJlZHVjZSgodmFsaWQsIGN1cikgPT4gdmFsaWQgJiYgdGhpcy5faXNDdXJzb3IoY3VyKSwgdHJ1ZSk7XG4gICAgICBpZiAoIWFyZUN1cnNvcnMpIHtcbiAgICAgICAgdGhpcy5lcnJvcihuZXcgRXJyb3IoJ1B1YmxpY2F0aW9uQ29sbGVjdG9yOiBQdWJsaXNoIGZ1bmN0aW9uIHJldHVybmVkIGFuIGFycmF5IG9mIG5vbi1DdXJzb3JzJykpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICAvLyBmaW5kIGR1cGxpY2F0ZSBjb2xsZWN0aW9uIG5hbWVzXG4gICAgICBjb25zdCBjb2xsZWN0aW9uTmFtZXMgPSB7fTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzLmxlbmd0aDsgKytpKSB7XG4gICAgICAgIGNvbnN0IGNvbGxlY3Rpb25OYW1lID0gcmVzW2ldLl9nZXRDb2xsZWN0aW9uTmFtZSgpO1xuICAgICAgICBpZiAoe30uaGFzT3duUHJvcGVydHkuY2FsbChjb2xsZWN0aW9uTmFtZXMsIGNvbGxlY3Rpb25OYW1lKSkge1xuICAgICAgICAgIHRoaXMuZXJyb3IobmV3IEVycm9yKFxuICAgICAgICAgICAgYFB1YmxpY2F0aW9uQ29sbGVjdG9yOiBQdWJsaXNoIGZ1bmN0aW9uIHJldHVybmVkIG11bHRpcGxlIGN1cnNvcnMgZm9yIGNvbGxlY3Rpb24gJHtjb2xsZWN0aW9uTmFtZX1gXG4gICAgICAgICAgKSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbGxlY3Rpb25OYW1lc1tjb2xsZWN0aW9uTmFtZV0gPSB0cnVlO1xuICAgICAgICBjdXJzb3JzLnB1c2gocmVzW2ldKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHJlcykge1xuICAgICAgLy8gdHJ1dGh5IHZhbHVlcyBvdGhlciB0aGFuIGN1cnNvcnMgb3IgYXJyYXlzIGFyZSBwcm9iYWJseSBhXG4gICAgICAvLyB1c2VyIG1pc3Rha2UgKHBvc3NpYmxlIHJldHVybmluZyBhIE1vbmdvIGRvY3VtZW50IHZpYSwgc2F5LFxuICAgICAgLy8gYGNvbGwuZmluZE9uZSgpYCkuXG4gICAgICB0aGlzLmVycm9yKG5ldyBFcnJvcignUHVibGljYXRpb25Db2xsZWN0b3I6IFB1Ymxpc2ggZnVuY3Rpb24gY2FuIG9ubHkgcmV0dXJuIGEgQ3Vyc29yIG9yIGFuIGFycmF5IG9mIEN1cnNvcnMnKSk7XG4gICAgfVxuXG4gICAgaWYgKGN1cnNvcnMubGVuZ3RoID4gMCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gZm9yIGVhY2ggY3Vyc29yIHdlIGNhbGwgX3B1Ymxpc2hDdXJzb3IgbWV0aG9kIHdoaWNoIHN0YXJ0cyBvYnNlcnZpbmcgdGhlIGN1cnNvciBhbmRcbiAgICAgICAgLy8gcHVibGlzaGVzIHRoZSByZXN1bHRzLlxuICAgICAgICBjdXJzb3JzLmZvckVhY2goKGN1cikgPT4ge1xuICAgICAgICAgIHRoaXMuX2Vuc3VyZUNvbGxlY3Rpb25JblJlcyhjdXIuX2dldENvbGxlY3Rpb25OYW1lKCkpO1xuICAgICAgICAgIGN1ci5fcHVibGlzaEN1cnNvcih0aGlzKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHRoaXMuZXJyb3IoZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gbWFyayBzdWJzY3JpcHRpb24gYXMgcmVhZHkgKF9wdWJsaXNoQ3Vyc29yIGRvZXMgTk9UIGNhbGwgcmVhZHkoKSlcbiAgICAgIHRoaXMucmVhZHkoKTtcbiAgICB9XG4gIH1cblxuICBhZGRlZChjb2xsZWN0aW9uLCBpZCwgZmllbGRzKSB7XG4gICAgY2hlY2soY29sbGVjdGlvbiwgU3RyaW5nKTtcbiAgICBjaGVjayhpZCwgdmFsaWRNb25nb0lkKTtcblxuICAgIHRoaXMuX2Vuc3VyZUNvbGxlY3Rpb25JblJlcyhjb2xsZWN0aW9uKTtcblxuICAgIC8vIE1ha2Ugc3VyZSB0byBpZ25vcmUgdGhlIF9pZCBpbiBmaWVsZHNcbiAgICBjb25zdCBhZGRlZERvY3VtZW50ID0gXy5leHRlbmQoe19pZDogaWR9LCBfLm9taXQoZmllbGRzLCAnX2lkJykpO1xuICAgIHRoaXMuX2RvY3VtZW50c1tjb2xsZWN0aW9uXVtpZF0gPSBhZGRlZERvY3VtZW50O1xuICB9XG5cbiAgY2hhbmdlZChjb2xsZWN0aW9uLCBpZCwgZmllbGRzKSB7XG4gICAgY2hlY2soY29sbGVjdGlvbiwgU3RyaW5nKTtcbiAgICBjaGVjayhpZCwgdmFsaWRNb25nb0lkKTtcblxuICAgIHRoaXMuX2Vuc3VyZUNvbGxlY3Rpb25JblJlcyhjb2xsZWN0aW9uKTtcblxuICAgIGNvbnN0IGV4aXN0aW5nRG9jdW1lbnQgPSB0aGlzLl9kb2N1bWVudHNbY29sbGVjdGlvbl1baWRdO1xuICAgIGNvbnN0IGZpZWxkc05vSWQgPSBfLm9taXQoZmllbGRzLCAnX2lkJyk7XG5cbiAgICBpZiAoZXhpc3RpbmdEb2N1bWVudCkge1xuICAgICAgXy5leHRlbmQoZXhpc3RpbmdEb2N1bWVudCwgZmllbGRzTm9JZCk7XG5cbiAgICAgIC8vIERlbGV0ZSBhbGwga2V5cyB0aGF0IHdlcmUgdW5kZWZpbmVkIGluIGZpZWxkcyAoZXhjZXB0IF9pZClcbiAgICAgIF8uZm9yRWFjaChmaWVsZHMsICh2YWx1ZSwga2V5KSA9PiB7XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgZGVsZXRlIGV4aXN0aW5nRG9jdW1lbnRba2V5XTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcmVtb3ZlZChjb2xsZWN0aW9uLCBpZCkge1xuICAgIGNoZWNrKGNvbGxlY3Rpb24sIFN0cmluZyk7XG4gICAgY2hlY2soaWQsIHZhbGlkTW9uZ29JZCk7XG5cbiAgICB0aGlzLl9lbnN1cmVDb2xsZWN0aW9uSW5SZXMoY29sbGVjdGlvbik7XG5cbiAgICBkZWxldGUgdGhpcy5fZG9jdW1lbnRzW2NvbGxlY3Rpb25dW2lkXTtcblxuICAgIGlmIChfLmlzRW1wdHkodGhpcy5fZG9jdW1lbnRzW2NvbGxlY3Rpb25dKSkge1xuICAgICAgZGVsZXRlIHRoaXMuX2RvY3VtZW50c1tjb2xsZWN0aW9uXTtcbiAgICB9XG4gIH1cblxuICByZWFkeSgpIHtcbiAgICAvLyBTeW5jaHJvbm91c2x5IGNhbGxzIGVhY2ggb2YgdGhlIGxpc3RlbmVycyByZWdpc3RlcmVkIGZvciB0aGUgXCJyZWFkeVwiIGV2ZW50XG4gICAgdGhpcy5lbWl0KCdyZWFkeScsIHRoaXMuX2dlbmVyYXRlUmVzcG9uc2UoKSk7XG4gIH1cblxuICBvblN0b3AoY2FsbGJhY2spIHtcbiAgICAvLyBBZGRzIGEgb25lIHRpbWUgbGlzdGVuZXIgZnVuY3Rpb24gZm9yIHRoZSBcInN0b3BcIiBldmVudFxuICAgIHRoaXMub25jZSgnc3RvcCcsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIHN0b3AoKSB7XG4gICAgLy8gU3luY2hyb25vdXNseSBjYWxscyBlYWNoIG9mIHRoZSBsaXN0ZW5lcnMgcmVnaXN0ZXJlZCBmb3IgdGhlIFwic3RvcFwiIGV2ZW50XG4gICAgdGhpcy5lbWl0KCdzdG9wJyk7XG4gIH1cblxuICBlcnJvcihlcnJvcikge1xuICAgIHRocm93IGVycm9yO1xuICB9XG5cbiAgX2lzQ3Vyc29yKGMpIHtcbiAgICByZXR1cm4gYyAmJiBjLl9wdWJsaXNoQ3Vyc29yO1xuICB9XG5cbiAgX2Vuc3VyZUNvbGxlY3Rpb25JblJlcyhjb2xsZWN0aW9uKSB7XG4gICAgdGhpcy5fZG9jdW1lbnRzW2NvbGxlY3Rpb25dID0gdGhpcy5fZG9jdW1lbnRzW2NvbGxlY3Rpb25dIHx8IHt9O1xuICB9XG5cbiAgX2dlbmVyYXRlUmVzcG9uc2UoKSB7XG4gICAgY29uc3Qgb3V0cHV0ID0ge307XG5cbiAgICBfLmZvckVhY2godGhpcy5fZG9jdW1lbnRzLCAoZG9jdW1lbnRzLCBjb2xsZWN0aW9uTmFtZSkgPT4ge1xuICAgICAgb3V0cHV0W2NvbGxlY3Rpb25OYW1lXSA9IF8udmFsdWVzKGRvY3VtZW50cyk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gb3V0cHV0O1xuICB9XG59XG4iXX0=
