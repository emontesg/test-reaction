(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var ECMAScript = Package.ecmascript.ECMAScript;
var Blaze = Package.blaze.Blaze;
var UI = Package.blaze.UI;
var Handlebars = Package.blaze.Handlebars;
var meteorInstall = Package.modules.meteorInstall;
var meteorBabelHelpers = Package['babel-runtime'].meteorBabelHelpers;
var Promise = Package.promise.Promise;
var HTML = Package.htmljs.HTML;

/* Package-scope variables */
var blazeToReact, BlazeComponent;

var require = meteorInstall({"node_modules":{"meteor":{"gadicc:blaze-react-component":{"blaze-react-component-server.js":function(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                            //
// packages/gadicc_blaze-react-component/blaze-react-component-server.js                      //
//                                                                                            //
////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                              //
var _interopRequireDefault = require("@babel/runtime/helpers/builtin/interopRequireDefault");

var _extends2 = _interopRequireDefault(require("@babel/runtime/helpers/builtin/extends"));

module.export({
  blazeToReact: () => blazeToReact
});
let React, Component;
module.watch(require("react"), {
  default(v) {
    React = v;
  },

  Component(v) {
    Component = v;
  }

}, 0);
let ReactDOM;
module.watch(require("react-dom"), {
  default(v) {
    ReactDOM = v;
  }

}, 1);
let Blaze;
module.watch(require("meteor/blaze"), {
  Blaze(v) {
    Blaze = v;
  }

}, 2);
let ReactiveVar;
module.watch(require("meteor/reactive-var"), {
  ReactiveVar(v) {
    ReactiveVar = v;
  }

}, 3);

const BlazeComponent = props => {
  const html = {
    __html: Blaze.toHTMLWithData(props.template, _.omit(props, 'template'))
  };
  return React.createElement("span", {
    dangerouslySetInnerHTML: html
  });
};

module.runSetters(blazeToReact = function (template) {
  return props => React.createElement(BlazeComponent, (0, _extends2.default)({}, props, {
    template: template
  }));
});
module.exportDefault(BlazeComponent);
////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});
var exports = require("/node_modules/meteor/gadicc:blaze-react-component/blaze-react-component-server.js");

/* Exports */
Package._define("gadicc:blaze-react-component", exports, {
  BlazeComponent: BlazeComponent,
  blazeToReact: blazeToReact
});

})();

//# sourceURL=meteor://💻app/packages/gadicc_blaze-react-component.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvZ2FkaWNjOmJsYXplLXJlYWN0LWNvbXBvbmVudC9ibGF6ZS1yZWFjdC1jb21wb25lbnQtc2VydmVyLmpzIl0sIm5hbWVzIjpbIm1vZHVsZSIsImV4cG9ydCIsImJsYXplVG9SZWFjdCIsIlJlYWN0IiwiQ29tcG9uZW50Iiwid2F0Y2giLCJyZXF1aXJlIiwiZGVmYXVsdCIsInYiLCJSZWFjdERPTSIsIkJsYXplIiwiUmVhY3RpdmVWYXIiLCJCbGF6ZUNvbXBvbmVudCIsInByb3BzIiwiaHRtbCIsIl9faHRtbCIsInRvSFRNTFdpdGhEYXRhIiwidGVtcGxhdGUiLCJfIiwib21pdCIsImV4cG9ydERlZmF1bHQiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBQSxPQUFPQyxNQUFQLENBQWM7QUFBQ0MsZ0JBQWEsTUFBSUE7QUFBbEIsQ0FBZDtBQUErQyxJQUFJQyxLQUFKLEVBQVVDLFNBQVY7QUFBb0JKLE9BQU9LLEtBQVAsQ0FBYUMsUUFBUSxPQUFSLENBQWIsRUFBOEI7QUFBQ0MsVUFBUUMsQ0FBUixFQUFVO0FBQUNMLFlBQU1LLENBQU47QUFBUSxHQUFwQjs7QUFBcUJKLFlBQVVJLENBQVYsRUFBWTtBQUFDSixnQkFBVUksQ0FBVjtBQUFZOztBQUE5QyxDQUE5QixFQUE4RSxDQUE5RTtBQUFpRixJQUFJQyxRQUFKO0FBQWFULE9BQU9LLEtBQVAsQ0FBYUMsUUFBUSxXQUFSLENBQWIsRUFBa0M7QUFBQ0MsVUFBUUMsQ0FBUixFQUFVO0FBQUNDLGVBQVNELENBQVQ7QUFBVzs7QUFBdkIsQ0FBbEMsRUFBMkQsQ0FBM0Q7QUFBOEQsSUFBSUUsS0FBSjtBQUFVVixPQUFPSyxLQUFQLENBQWFDLFFBQVEsY0FBUixDQUFiLEVBQXFDO0FBQUNJLFFBQU1GLENBQU4sRUFBUTtBQUFDRSxZQUFNRixDQUFOO0FBQVE7O0FBQWxCLENBQXJDLEVBQXlELENBQXpEO0FBQTRELElBQUlHLFdBQUo7QUFBZ0JYLE9BQU9LLEtBQVAsQ0FBYUMsUUFBUSxxQkFBUixDQUFiLEVBQTRDO0FBQUNLLGNBQVlILENBQVosRUFBYztBQUFDRyxrQkFBWUgsQ0FBWjtBQUFjOztBQUE5QixDQUE1QyxFQUE0RSxDQUE1RTs7QUFLclQsTUFBTUksaUJBQWtCQyxLQUFELElBQVc7QUFDaEMsUUFBTUMsT0FBTztBQUNYQyxZQUFRTCxNQUFNTSxjQUFOLENBQ05ILE1BQU1JLFFBREEsRUFFTkMsRUFBRUMsSUFBRixDQUFPTixLQUFQLEVBQWMsVUFBZCxDQUZNO0FBREcsR0FBYjtBQU9BLFNBQVM7QUFBTSw2QkFBeUJDO0FBQS9CLElBQVQ7QUFDRCxDQVREOztBQVdBLGlDQUFlLFVBQVNHLFFBQVQsRUFBbUI7QUFDaEMsU0FBUUosS0FBRCxJQUFXLG9CQUFDLGNBQUQsNkJBQW9CQSxLQUFwQjtBQUEyQixjQUFVSTtBQUFyQyxLQUFsQjtBQUNELENBRkQ7QUFoQkFqQixPQUFPb0IsYUFBUCxDQXFCZVIsY0FyQmYsRSIsImZpbGUiOiIvcGFja2FnZXMvZ2FkaWNjX2JsYXplLXJlYWN0LWNvbXBvbmVudC5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBSZWFjdCwgeyBDb21wb25lbnQgfSBmcm9tICdyZWFjdCc7XG5pbXBvcnQgUmVhY3RET00gZnJvbSAncmVhY3QtZG9tJztcbmltcG9ydCB7IEJsYXplIH0gZnJvbSAnbWV0ZW9yL2JsYXplJztcbmltcG9ydCB7IFJlYWN0aXZlVmFyIH0gZnJvbSAnbWV0ZW9yL3JlYWN0aXZlLXZhcic7XG5cbmNvbnN0IEJsYXplQ29tcG9uZW50ID0gKHByb3BzKSA9PiB7XG4gIGNvbnN0IGh0bWwgPSB7XG4gICAgX19odG1sOiBCbGF6ZS50b0hUTUxXaXRoRGF0YShcbiAgICAgIHByb3BzLnRlbXBsYXRlLFxuICAgICAgXy5vbWl0KHByb3BzLCAndGVtcGxhdGUnKVxuICAgKVxuICB9O1xuXG4gIHJldHVybiAoIDxzcGFuIGRhbmdlcm91c2x5U2V0SW5uZXJIVE1MPXtodG1sfSAvPiApO1xufVxuXG5ibGF6ZVRvUmVhY3QgPSBmdW5jdGlvbih0ZW1wbGF0ZSkge1xuICByZXR1cm4gKHByb3BzKSA9PiA8QmxhemVDb21wb25lbnQgey4uLnByb3BzfSB0ZW1wbGF0ZT17dGVtcGxhdGV9IC8+O1xufVxuXG5leHBvcnQgeyBibGF6ZVRvUmVhY3QgfTtcbmV4cG9ydCBkZWZhdWx0IEJsYXplQ29tcG9uZW50O1xuIl19
