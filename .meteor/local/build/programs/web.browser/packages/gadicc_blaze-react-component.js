//////////////////////////////////////////////////////////////////////////
//                                                                      //
// This is a generated file. You can view the original                  //
// source in your browser if your browser supports source maps.         //
// Source maps are supported by all recent versions of Chrome, Safari,  //
// and Firefox, and by Internet Explorer 11.                            //
//                                                                      //
//////////////////////////////////////////////////////////////////////////


(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var Blaze = Package.blaze.Blaze;
var UI = Package.blaze.UI;
var Handlebars = Package.blaze.Handlebars;
var Template = Package['templating-runtime'].Template;
var ReactiveVar = Package['reactive-var'].ReactiveVar;
var meteorInstall = Package.modules.meteorInstall;
var meteorBabelHelpers = Package['babel-runtime'].meteorBabelHelpers;
var Promise = Package.promise.Promise;
var HTML = Package.htmljs.HTML;
var Symbol = Package['ecmascript-runtime-client'].Symbol;
var Map = Package['ecmascript-runtime-client'].Map;
var Set = Package['ecmascript-runtime-client'].Set;
var Spacebars = Package.spacebars.Spacebars;

/* Package-scope variables */
var blazeToReact, BlazeComponent;

var require = meteorInstall({"node_modules":{"meteor":{"gadicc:blaze-react-component":{"blaze-react-component-client.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                             //
// packages/gadicc_blaze-react-component/blaze-react-component-client.js                       //
//                                                                                             //
/////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                               //
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

var _extends2 = _interopRequireDefault(require("@babel/runtime/helpers/extends"));

var _typeof2 = _interopRequireDefault(require("@babel/runtime/helpers/typeof"));

var _inheritsLoose2 = _interopRequireDefault(require("@babel/runtime/helpers/inheritsLoose"));

module.export({
  blazeToReact: function () {
    return blazeToReact;
  }
});
var React, Component;
module.watch(require("react"), {
  "default": function (v) {
    React = v;
  },
  Component: function (v) {
    Component = v;
  }
}, 0);
var ReactDOM;
module.watch(require("react-dom"), {
  "default": function (v) {
    ReactDOM = v;
  }
}, 1);
var Blaze;
module.watch(require("meteor/blaze"), {
  Blaze: function (v) {
    Blaze = v;
  }
}, 2);
var ReactiveVar;
module.watch(require("meteor/reactive-var"), {
  ReactiveVar: function (v) {
    ReactiveVar = v;
  }
}, 3);
var Template;
module.watch(require("meteor/templating"), {
  Template: function (v) {
    Template = v;
  }
}, 4);

var BlazeComponent =
/*#__PURE__*/
function (_Component) {
  (0, _inheritsLoose2.default)(BlazeComponent, _Component);

  function BlazeComponent() {
    return _Component.apply(this, arguments) || this;
  }

  var _proto = BlazeComponent.prototype;

  _proto.componentDidMount = function () {
    function componentDidMount() {
      this.renderBlazeView();
    }

    return componentDidMount;
  }();

  _proto.componentDidUpdate = function () {
    function componentDidUpdate(prevProps) {
      if (prevProps.template != this.props.template) {
        Blaze.remove(this._blazeView);
        this.renderBlazeView();
      }
    }

    return componentDidUpdate;
  }();

  _proto.renderBlazeView = function () {
    function renderBlazeView() {
      var _this = this;

      this._blazeData = new ReactiveVar(_.omit(this.props, 'template'));
      var template,
          tArg = this.props.template;

      if (typeof tArg === 'string') {
        template = Template[tArg];
        if (!template) throw new Error("No Template[\"" + tArg + "\"] exists.  If this template " + "originates in your app, make sure you have the `templating` " + "package installed (and not, for e.g. `static-html`)");
      } else if (tArg instanceof Blaze.Template) {
        template = tArg;
      } else {
        throw new Error("Invalid template= argument specified.  Expected " + "the string name of an existing Template, or the template " + "itself, instead got ''" + (0, _typeof2.default)(tArg) + ": " + JSON.stringify(tArg));
      }

      this._blazeView = Blaze.renderWithData(template, function () {
        return _this._blazeData.get();
      }, ReactDOM.findDOMNode(this._blazeRef));
    }

    return renderBlazeView;
  }();

  _proto.shouldComponentUpdate = function () {
    function shouldComponentUpdate(nextProps) {
      // Never call render() for props except template again; Blaze will do what's necessary.
      return nextProps.template !== this.props.template;
    }

    return shouldComponentUpdate;
  }();

  _proto.componentWillReceiveProps = function () {
    function componentWillReceiveProps(nextProps) {
      this._blazeData.set(_.omit(nextProps, 'template'));
    }

    return componentWillReceiveProps;
  }();

  _proto.componentWillUnmount = function () {
    function componentWillUnmount() {
      Blaze.remove(this._blazeView);
    }

    return componentWillUnmount;
  }();

  _proto.render = function () {
    function render() {
      var _this2 = this;

      return React.createElement("span", {
        className: this.props.className || '',
        ref: function (c) {
          return _this2._blazeRef = c;
        }
      });
    }

    return render;
  }();

  return BlazeComponent;
}(Component);

module.runSetters(blazeToReact = function (template) {
  return function (props) {
    return React.createElement(BlazeComponent, (0, _extends2.default)({}, props, {
      template: template
    }));
  };
});
module.exportDefault(BlazeComponent);
/////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});
var exports = require("/node_modules/meteor/gadicc:blaze-react-component/blaze-react-component-client.js");

/* Exports */
Package._define("gadicc:blaze-react-component", exports, {
  BlazeComponent: BlazeComponent,
  blazeToReact: blazeToReact
});

})();
