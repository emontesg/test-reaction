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
var Accounts = Package['accounts-base'].Accounts;
var OAuth = Package.oauth.OAuth;
var Oauth = Package.oauth.Oauth;
var Template = Package['templating-runtime'].Template;
var Random = Package.random.Random;
var ServiceConfiguration = Package['service-configuration'].ServiceConfiguration;
var Blaze = Package.blaze.Blaze;
var UI = Package.blaze.UI;
var Handlebars = Package.blaze.Handlebars;
var Spacebars = Package.spacebars.Spacebars;
var HTML = Package.htmljs.HTML;

/* Package-scope variables */
var Knowledge, scope;

(function(){

/////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                     //
// packages/knowledgeio_accounts-knowledge/knowledge_client.js                                         //
//                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                       //
Knowledge = {};

Knowledge.requestCredential = function (options, credentialRequestCompleteCallback) {
  if (!credentialRequestCompleteCallback && typeof options === 'function') {
    credentialRequestCompleteCallback = options;
    options = {};
  }

  var config = ServiceConfiguration.configurations.findOne({ service: 'knowledge' });

  if (!config) {
    if (credentialRequestCompleteCallback) {
      credentialRequestCompleteCallback(new ServiceConfiguration.ConfigError());
    }

    return;
  }

  var credentialToken = Random.secret();
  var loginStyle = OAuth._loginStyle('knowledge', config, options);

  if (typeof scope === 'string') {
    scope = [scope];
  }

  var flatScope = _.map(scope, encodeURIComponent).join('+');
  var credentialToken = Random.secret();
  var absoluteUrlOptions = {};
  var rootUrl = this.rootUrl();
  if (rootUrl) {
    absoluteUrlOptions.rootUrl = rootUrl;
  }

  var uri = OAuth._redirectUri('knowledge', config, null, absoluteUrlOptions);
  var oidc_scope = "openid email roles profile";
  var oidc_clientid = "knowledge-code";
  var redUrl = "https://store.local.knowledge.io/_oauth/knowledge";
  var state = OAuth._stateParam(loginStyle, credentialToken);
  var loginUrl2 = "https://accounts.play.knowledge.io/auth?response_type=id_token%20token&client_id=knowledge&scope=openid+email&redirect_uri=" + redUrl + "&nonce=09382a4b9cf540bc9fb5fb29db632b01";
  var loginUrl = "https://accounts.play.knowledge.io/auth?" + "response_type=code&client_id=" + oidc_clientid + "&scope=" + oidc_scope + "&redirect_uri=" + redUrl + "&state=" + state + "&nonce=zwPLUqogyue3HbSRdhQ8SenA79H3yNfntYxGNObw0lk&display=popup";
  OAuth.launchLogin({
    loginService: "knowledge",
    loginStyle: loginStyle,
    loginUrl: loginUrl,
    credentialRequestCompleteCallback: credentialRequestCompleteCallback,
    credentialToken: credentialToken
  });
};


// override this method to set the root redirect URL
// useful for multi-tenant environments
Knowledge.rootUrl = function () { /* noop */ };

/////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function(){

/////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                     //
// packages/knowledgeio_accounts-knowledge/knowledge.js                                                //
//                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                       //
Accounts.oauth.registerService('knowledge');

if (Meteor.isClient) {
  Meteor.loginWithKnowledge = function (options, callback) {
    // support a callback without options
    if (!callback && typeof options === "function") {
      callback = options;
      options = null;
    }
    var credentialRequestCompleteCallback = Accounts.oauth.credentialRequestCompleteHandler(callback);

    Knowledge.requestCredential(options, credentialRequestCompleteCallback);
  };
} else {
  Accounts.addAutopublishFields({
    forLoggedInUser: ['services.knowledge'],
    forOtherUsers: [
      'services.knowledge.username',
      'services.knowledge.full_name',
      'services.knowledge.profile_picture'
    ]
  });
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function(){

/////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                     //
// packages/knowledgeio_accounts-knowledge/template.knowledge_configuration.js                         //
//                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                       //

Template.__checkName("configureLoginServiceDialogForKnowledge");
Template["configureLoginServiceDialogForKnowledge"] = new Template("Template.configureLoginServiceDialogForKnowledge", (function() {
  var view = this;
  return [ HTML.Raw("<p>\n        Follow these steps to configure your Untappd client:\n    </p>\n    "), HTML.OL("\n        ", HTML.LI("\n            Set Callback URL to: ", HTML.SPAN({
    "class": "url"
  }, Blaze.View(function() {
    return Spacebars.mustache(view.lookup("siteUrl"));
  }), "_oauth/untappd"), "\n        "), "\n    ") ];
}));

/////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function(){

/////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                     //
// packages/knowledgeio_accounts-knowledge/knowledge_configuration.js                                  //
//                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                       //
Template.configureLoginServiceDialogForKnowledge.helpers({
  siteUrl: function () {
    return Meteor.absoluteUrl();
  }
});

Template.configureLoginServiceDialogForKnowledge.fields = function () {
  return [
    { property: 'clientId', label: 'Client Id' },
    { property: 'secret', label: 'Client Secret' }
  ];
};

/////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
Package._define("knowledgeio:accounts-knowledge", {
  Knowledge: Knowledge
});

})();
