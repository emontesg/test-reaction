(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var ECMAScript = Package.ecmascript.ECMAScript;
var check = Package.check.check;
var Match = Package.check.Match;
var DDP = Package['ddp-client'].DDP;
var DDPServer = Package['ddp-server'].DDPServer;
var _ = Package.underscore._;
var meteorInstall = Package.modules.meteorInstall;
var meteorBabelHelpers = Package['babel-runtime'].meteorBabelHelpers;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var ValidatedMethod, options, callback, args, methodInvocation;

var require = meteorInstall({"node_modules":{"meteor":{"mdg:validated-method":{"validated-method.js":function(){

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/mdg_validated-method/validated-method.js                                                //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
/* global ValidatedMethod:true */
ValidatedMethod = class ValidatedMethod {
  constructor(options) {
    // Default to no mixins
    options.mixins = options.mixins || [];
    check(options.mixins, [Function]);
    check(options.name, String);
    options = applyMixins(options, options.mixins); // connection argument defaults to Meteor, which is where Methods are defined on client and
    // server

    options.connection = options.connection || Meteor; // Allow validate: null shorthand for methods that take no arguments

    if (options.validate === null) {
      options.validate = function () {};
    } // If this is null/undefined, make it an empty object


    options.applyOptions = options.applyOptions || {};
    check(options, Match.ObjectIncluding({
      name: String,
      validate: Function,
      run: Function,
      mixins: [Function],
      connection: Object,
      applyOptions: Object
    })); // Default options passed to Meteor.apply, can be overridden with applyOptions

    const defaultApplyOptions = {
      // Make it possible to get the ID of an inserted item
      returnStubValue: true,
      // Don't call the server method if the client stub throws an error, so that we don't end
      // up doing validations twice
      throwStubExceptions: true
    };
    options.applyOptions = _.extend({}, defaultApplyOptions, options.applyOptions); // Attach all options to the ValidatedMethod instance

    _.extend(this, options);

    const method = this;
    this.connection.methods({
      [options.name](args) {
        // Silence audit-argument-checks since arguments are always checked when using this package
        check(args, Match.Any);
        const methodInvocation = this;
        return method._execute(methodInvocation, args);
      }

    });
  }

  call(args, callback) {
    // Accept calling with just a callback
    if (_.isFunction(args)) {
      callback = args;
      args = {};
    }

    try {
      return this.connection.apply(this.name, [args], this.applyOptions, callback);
    } catch (err) {
      if (callback) {
        // Get errors from the stub in the same way as from the server-side method
        callback(err);
      } else {
        // No callback passed, throw instead of silently failing; this is what
        // "normal" Methods do if you don't pass a callback.
        throw err;
      }
    }
  }

  _execute(methodInvocation, args) {
    methodInvocation = methodInvocation || {}; // Add `this.name` to reference the Method name

    methodInvocation.name = this.name;
    const validateResult = this.validate.bind(methodInvocation)(args);

    if (typeof validateResult !== 'undefined') {
      throw new Error(`Returning from validate doesn't do anything; \
perhaps you meant to throw an error?`);
    }

    return this.run.bind(methodInvocation)(args);
  }

}; // Mixins get a chance to transform the arguments before they are passed to the actual Method

function applyMixins(args, mixins) {
  // You can pass nested arrays so that people can ship mixin packs
  const flatMixins = _.flatten(mixins); // Save name of the method here, so we can attach it to potential error messages


  const {
    name
  } = args;
  flatMixins.forEach(mixin => {
    args = mixin(args);

    if (!Match.test(args, Object)) {
      const functionName = mixin.toString().match(/function\s(\w+)/);
      let msg = 'One of the mixins';

      if (functionName) {
        msg = `The function '${functionName[1]}'`;
      }

      throw new Error(`Error in ${name} method: ${msg} didn't return the options object.`);
    }
  });
  return args;
}
//////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});
require("/node_modules/meteor/mdg:validated-method/validated-method.js");

/* Exports */
Package._define("mdg:validated-method", {
  ValidatedMethod: ValidatedMethod
});

})();

//# sourceURL=meteor://💻app/packages/mdg_validated-method.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbWRnOnZhbGlkYXRlZC1tZXRob2QvdmFsaWRhdGVkLW1ldGhvZC5qcyJdLCJuYW1lcyI6WyJWYWxpZGF0ZWRNZXRob2QiLCJjb25zdHJ1Y3RvciIsIm9wdGlvbnMiLCJtaXhpbnMiLCJjaGVjayIsIkZ1bmN0aW9uIiwibmFtZSIsIlN0cmluZyIsImFwcGx5TWl4aW5zIiwiY29ubmVjdGlvbiIsIk1ldGVvciIsInZhbGlkYXRlIiwiYXBwbHlPcHRpb25zIiwiTWF0Y2giLCJPYmplY3RJbmNsdWRpbmciLCJydW4iLCJPYmplY3QiLCJkZWZhdWx0QXBwbHlPcHRpb25zIiwicmV0dXJuU3R1YlZhbHVlIiwidGhyb3dTdHViRXhjZXB0aW9ucyIsIl8iLCJleHRlbmQiLCJtZXRob2QiLCJtZXRob2RzIiwiYXJncyIsIkFueSIsIm1ldGhvZEludm9jYXRpb24iLCJfZXhlY3V0ZSIsImNhbGwiLCJjYWxsYmFjayIsImlzRnVuY3Rpb24iLCJhcHBseSIsImVyciIsInZhbGlkYXRlUmVzdWx0IiwiYmluZCIsIkVycm9yIiwiZmxhdE1peGlucyIsImZsYXR0ZW4iLCJmb3JFYWNoIiwibWl4aW4iLCJ0ZXN0IiwiZnVuY3Rpb25OYW1lIiwidG9TdHJpbmciLCJtYXRjaCIsIm1zZyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFFQUEsa0JBQWtCLE1BQU1BLGVBQU4sQ0FBc0I7QUFDdENDLGNBQVlDLE9BQVosRUFBcUI7QUFDbkI7QUFDQUEsWUFBUUMsTUFBUixHQUFpQkQsUUFBUUMsTUFBUixJQUFrQixFQUFuQztBQUNBQyxVQUFNRixRQUFRQyxNQUFkLEVBQXNCLENBQUNFLFFBQUQsQ0FBdEI7QUFDQUQsVUFBTUYsUUFBUUksSUFBZCxFQUFvQkMsTUFBcEI7QUFDQUwsY0FBVU0sWUFBWU4sT0FBWixFQUFxQkEsUUFBUUMsTUFBN0IsQ0FBVixDQUxtQixDQU9uQjtBQUNBOztBQUNBRCxZ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QU9lLE1BQU1mLElBQU4sQ0FBUDs7QUFFQSxRQUFHLENBQUNYLE1BQU0yQixJQUFOLENBQVdoQixJQUFYLEVBQWlCUixNQUFqQixDQUFKLEVBQThCO0FBQzVCLFlBQU15QixlQUFlRixNQUFNRyxRQUFOLEdBQWlCQyxLQUFqQixDQUF1QixpQkFBdkIsQ0FBckI7QUFDQSxVQUFJQyxNQUFNLG1CQUFWOztBQUVBLFVBQUdILFlBQUgsRUFBaUI7QUFDZkcsY0FBTyxpQkFBZ0JILGFBQWEsQ0FBYixDQUFnQixHQUF2QztBQUNEOztBQUVELFlBQU0sSUFBSU4sS0FBSixDQUFXLFlBQVc3QixJQUFLLFlBQVdzQyxHQUFJLG9DQUExQyxDQUFOO0FBQ0Q7QUFDRixHQWJEO0FBZUEsU0FBT3BCLElBQVA7QUFDRCxDIiwiZmlsZSI6Ii9wYWNrYWdlcy9tZGdfdmFsaWRhdGVkLW1ldGhvZC5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8qIGdsb2JhbCBWYWxpZGF0ZWRNZXRob2Q6dHJ1ZSAqL1xuXG5WYWxpZGF0ZWRNZXRob2QgPSBjbGFzcyBWYWxpZGF0ZWRNZXRob2Qge1xuICBjb25zdHJ1Y3RvcihvcHRpb25zKSB7XG4gICAgLy8gRGVmYXVsdCB0byBubyBtaXhpbnNcbiAgICBvcHRpb25zLm1peGlucyA9IG9wdGlvbnMubWl4aW5zIHx8IFtdO1xuICAgIGNoZWNrKG9wdGlvbnMubWl4aW5zLCBbRnVuY3Rpb25dKTtcbiAgICBjaGVjayhvcHRpb25zLm5hbWUsIFN0cmluZyk7XG4gICAgb3B0aW9ucyA9IGFwcGx5TWl4aW5zKG9wdGlvbnMsIG9wdGlvbnMubWl4aW5zKTtcblxuICAgIC8vIGNvbm5lY3Rpb24gYXJndW1lbnQgZGVmYXVsdHMgdG8gTWV0ZW9yLCB3aGljaCBpcyB3aGVyZSBNZXRob2RzIGFyZSBkZWZpbmVkIG9uIGNsaWVudCBhbmRcbiAgICAvLyBzZXJ2ZXJcbiAgICBvcHRpb25zLmNvbm5lY3Rpb24gPSBvcHRpb25zLmNvbm5lY3Rpb24gfHwgTWV0ZW9yO1xuXG4gICAgLy8gQWxsb3cgdmFsaWRhdGU6IG51bGwgc2hvcnRoYW5kIGZvciBtZXRob2RzIHRoYXQgdGFrZSBubyBhcmd1bWVudHNcbiAgICBpZiAob3B0aW9ucy52YWxpZGF0ZSA9PT0gbnVsbCkge1xuICAgICAgb3B0aW9ucy52YWxpZGF0ZSA9IGZ1bmN0aW9uICgpIHt9O1xuICAgIH1cblxuICAgIC8vIElmIHRoaXMgaXMgbnVsbC91bmRlZmluZWQsIG1ha2UgaXQgYW4gZW1wdHkgb2JqZWN0XG4gICAgb3B0aW9ucy5hcHBseU9wdGlvbnMgPSBvcHRpb25zLmFwcGx5T3B0aW9ucyB8fCB7fTtcblxuICAgIGNoZWNrKG9wdGlvbnMsIE1hdGNoLk9iamVjdEluY2x1ZGluZyh7XG4gICAgICBuYW1lOiBTdHJpbmcsXG4gICAgICB2YWxpZGF0ZTogRnVuY3Rpb24sXG4gICAgICBydW46IEZ1bmN0aW9uLFxuICAgICAgbWl4aW5zOiBbRnVuY3Rpb25dLFxuICAgICAgY29ubmVjdGlvbjogT2JqZWN0LFxuICAgICAgYXBwbHlPcHRpb25zOiBPYmplY3QsXG4gICAgfSkpO1xuXG4gICAgLy8gRGVmYXVsdCBvcHRpb25zIHBhc3NlZCB0byBNZXRlb3IuYXBwbHksIGNhbiBiZSBvdmVycmlkZGVuIHdpdGggYXBwbHlPcHRpb25zXG4gICAgY29uc3QgZGVmYXVsdEFwcGx5T3B0aW9ucyA9IHtcbiAgICAgIC8vIE1ha2UgaXQgcG9zc2libGUgdG8gZ2V0IHRoZSBJRCBvZiBhbiBpbnNlcnRlZCBpdGVtXG4gICAgICByZXR1cm5TdHViVmFsdWU6IHRydWUsXG5cbiAgICAgIC8vIERvbid0IGNhbGwgdGhlIHNlcnZlciBtZXRob2QgaWYgdGhlIGNsaWVudCBzdHViIHRocm93cyBhbiBlcnJvciwgc28gdGhhdCB3ZSBkb24ndCBlbmRcbiAgICAgIC8vIHVwIGRvaW5nIHZhbGlkYXRpb25zIHR3aWNlXG4gICAgICB0aHJvd1N0dWJFeGNlcHRpb25zOiB0cnVlLFxuICAgIH07XG5cbiAgICBvcHRpb25zLmFwcGx5T3B0aW9ucyA9IF8uZXh0ZW5kKHt9LCBkZWZhdWx0QXBwbHlPcHRpb25zLCBvcHRpb25zLmFwcGx5T3B0aW9ucyk7XG5cbiAgICAvLyBBdHRhY2ggYWxsIG9wdGlvbnMgdG8gdGhlIFZhbGlkYXRlZE1ldGhvZCBpbnN0YW5jZVxuICAgIF8uZXh0ZW5kKHRoaXMsIG9wdGlvbnMpO1xuXG4gICAgY29uc3QgbWV0aG9kID0gdGhpcztcbiAgICB0aGlzLmNvbm5lY3Rpb24ubWV0aG9kcyh7XG4gICAgICBbb3B0aW9ucy5uYW1lXShhcmdzKSB7XG4gICAgICAgIC8vIFNpbGVuY2UgYXVkaXQtYXJndW1lbnQtY2hlY2tzIHNpbmNlIGFyZ3VtZW50cyBhcmUgYWx3YXlzIGNoZWNrZWQgd2hlbiB1c2luZyB0aGlzIHBhY2thZ2VcbiAgICAgICAgY2hlY2soYXJncywgTWF0Y2guQW55KTtcbiAgICAgICAgY29uc3QgbWV0aG9kSW52b2NhdGlvbiA9IHRoaXM7XG5cbiAgICAgICAgcmV0dXJuIG1ldGhvZC5fZXhlY3V0ZShtZXRob2RJbnZvY2F0aW9uLCBhcmdzKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGNhbGwoYXJncywgY2FsbGJhY2spIHtcbiAgICAvLyBBY2NlcHQgY2FsbGluZyB3aXRoIGp1c3QgYSBjYWxsYmFja1xuICAgIGlmIChfLmlzRnVuY3Rpb24oYXJncykpIHtcbiAgICAgIGNhbGxiYWNrID0gYXJncztcbiAgICAgIGFyZ3MgPSB7fTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvbi5hcHBseSh0aGlzLm5hbWUsIFthcmdzXSwgdGhpcy5hcHBseU9wdGlvbnMsIGNhbGxiYWNrKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAvLyBHZXQgZXJyb3JzIGZyb20gdGhlIHN0dWIgaW4gdGhlIHNhbWUgd2F5IGFzIGZyb20gdGhlIHNlcnZlci1zaWRlIG1ldGhvZFxuICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gTm8gY2FsbGJhY2sgcGFzc2VkLCB0aHJvdyBpbnN0ZWFkIG9mIHNpbGVudGx5IGZhaWxpbmc7IHRoaXMgaXMgd2hhdFxuICAgICAgICAvLyBcIm5vcm1hbFwiIE1ldGhvZHMgZG8gaWYgeW91IGRvbid0IHBhc3MgYSBjYWxsYmFjay5cbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIF9leGVjdXRlKG1ldGhvZEludm9jYXRpb24sIGFyZ3MpIHtcbiAgICBtZXRob2RJbnZvY2F0aW9uID0gbWV0aG9kSW52b2NhdGlvbiB8fCB7fTtcblxuICAgIC8vIEFkZCBgdGhpcy5uYW1lYCB0byByZWZlcmVuY2UgdGhlIE1ldGhvZCBuYW1lXG4gICAgbWV0aG9kSW52b2NhdGlvbi5uYW1lID0gdGhpcy5uYW1lO1xuXG4gICAgY29uc3QgdmFsaWRhdGVSZXN1bHQgPSB0aGlzLnZhbGlkYXRlLmJpbmQobWV0aG9kSW52b2NhdGlvbikoYXJncyk7XG5cbiAgICBpZiAodHlwZW9mIHZhbGlkYXRlUmVzdWx0ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZXR1cm5pbmcgZnJvbSB2YWxpZGF0ZSBkb2Vzbid0IGRvIGFueXRoaW5nOyBcXFxucGVyaGFwcyB5b3UgbWVhbnQgdG8gdGhyb3cgYW4gZXJyb3I/YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucnVuLmJpbmQobWV0aG9kSW52b2NhdGlvbikoYXJncyk7XG4gIH1cbn07XG5cbi8vIE1peGlucyBnZXQgYSBjaGFuY2UgdG8gdHJhbnNmb3JtIHRoZSBhcmd1bWVudHMgYmVmb3JlIHRoZXkgYXJlIHBhc3NlZCB0byB0aGUgYWN0dWFsIE1ldGhvZFxuZnVuY3Rpb24gYXBwbHlNaXhpbnMoYXJncywgbWl4aW5zKSB7XG4gIC8vIFlvdSBjYW4gcGFzcyBuZXN0ZWQgYXJyYXlzIHNvIHRoYXQgcGVvcGxlIGNhbiBzaGlwIG1peGluIHBhY2tzXG4gIGNvbnN0IGZsYXRNaXhpbnMgPSBfLmZsYXR0ZW4obWl4aW5zKTtcbiAgLy8gU2F2ZSBuYW1lIG9mIHRoZSBtZXRob2QgaGVyZSwgc28gd2UgY2FuIGF0dGFjaCBpdCB0byBwb3RlbnRpYWwgZXJyb3IgbWVzc2FnZXNcbiAgY29uc3Qge25hbWV9ID0gYXJncztcblxuICBmbGF0TWl4aW5zLmZvckVhY2goKG1peGluKSA9PiB7XG4gICAgYXJncyA9IG1peGluKGFyZ3MpO1xuXG4gICAgaWYoIU1hdGNoLnRlc3QoYXJncywgT2JqZWN0KSkge1xuICAgICAgY29uc3QgZnVuY3Rpb25OYW1lID0gbWl4aW4udG9TdHJpbmcoKS5tYXRjaCgvZnVuY3Rpb25cXHMoXFx3KykvKTtcbiAgICAgIGxldCBtc2cgPSAnT25lIG9mIHRoZSBtaXhpbnMnO1xuXG4gICAgICBpZihmdW5jdGlvbk5hbWUpIHtcbiAgICAgICAgbXNnID0gYFRoZSBmdW5jdGlvbiAnJHtmdW5jdGlvbk5hbWVbMV19J2A7XG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3IgaW4gJHtuYW1lfSBtZXRob2Q6ICR7bXNnfSBkaWRuJ3QgcmV0dXJuIHRoZSBvcHRpb25zIG9iamVjdC5gKTtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiBhcmdzO1xufVxuIl19
