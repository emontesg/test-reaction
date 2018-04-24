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
var Template = Package['templating-runtime'].Template;
var Blaze = Package.blaze.Blaze;
var UI = Package.blaze.UI;
var Handlebars = Package.blaze.Handlebars;
var Spacebars = Package.spacebars.Spacebars;
var HTML = Package.htmljs.HTML;

(function(){

///////////////////////////////////////////////////////////////////////////////////
//                                                                               //
// packages/twitter-config-ui/template.twitter_configure.js                      //
//                                                                               //
///////////////////////////////////////////////////////////////////////////////////
                                                                                 //

Template.__checkName("configureLoginServiceDialogForTwitter");
Template["configureLoginServiceDialogForTwitter"] = new Template("Template.configureLoginServiceDialogForTwitter", (function() {
  var view = this;
  return [ HTML.Raw("<p>\n    First, you'll need to register your app on Twitter. Follow these steps:\n  </p>\n  "), HTML.OL("\n    ", HTML.Raw('<li>\n      Visit <a href="https://apps.twitter.com/app/new" target="_blank">https://apps.twitter.com/app/new</a>\n    </li>'), "\n    ", HTML.LI("\n      Set Website to: ", HTML.SPAN({
    class: "url"
  }, Blaze.View("lookup:siteUrl", function() {
    return Spacebars.mustache(view.lookup("siteUrl"));
  })), "\n    "), "\n    ", HTML.LI("\n      Set Callback URL to: ", HTML.SPAN({
    class: "url"
  }, Blaze.View("lookup:siteUrl", function() {
    return Spacebars.mustache(view.lookup("siteUrl"));
  }), "_oauth/twitter"), "\n    "), "\n    ", HTML.Raw('<li>\n      Select "Create your Twitter application".\n    </li>'), "\n    ", HTML.Raw('<li>\n      On the Settings tab, enable "Allow this application to be used to Sign in with Twitter" and click\n      "Update settings".\n    </li>'), "\n    ", HTML.Raw('<li>\n      Switch to the "Keys and Access Tokens" tab.\n    </li>'), "\n  ") ];
}));

///////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function(){

///////////////////////////////////////////////////////////////////////////////////
//                                                                               //
// packages/twitter-config-ui/twitter_configure.js                               //
//                                                                               //
///////////////////////////////////////////////////////////////////////////////////
                                                                                 //
Template.configureLoginServiceDialogForTwitter.helpers({
  siteUrl: function () {
  // Twitter doesn't recognize localhost as a domain name
    return Meteor.absoluteUrl({replaceLocalhost: true});
  }
});

Template.configureLoginServiceDialogForTwitter.fields = function () {
  return [
    {property: 'consumerKey', label: 'API key'},
    {property: 'secret', label: 'API secret'}
  ];
};

///////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
Package._define("twitter-config-ui");

})();
