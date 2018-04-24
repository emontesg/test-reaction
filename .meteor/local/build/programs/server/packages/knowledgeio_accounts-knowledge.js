(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var Accounts = Package['accounts-base'].Accounts;
var OAuth = Package.oauth.OAuth;
var Oauth = Package.oauth.Oauth;
var HTTP = Package.http.HTTP;
var HTTPInternals = Package.http.HTTPInternals;
var _ = Package.underscore._;
var ServiceConfiguration = Package['service-configuration'].ServiceConfiguration;

/* Package-scope variables */
var Knowledge, getConfigProvider;

(function(){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                 //
// packages/knowledgeio_accounts-knowledge/knowledge_server.js                                                     //
//                                                                                                                 //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                   //
Knowledge = {};

Oauth.registerService('knowledge', 2, null, function (query) {
  const config = ServiceConfiguration.configurations.findOne({ service: 'knowledge' });
  const response = getToken(query);
  const token = response.data;
  const accessToken = token.access_token;
  const identity = getUserInfo(accessToken);
  if (token.refreshToken) {
    serviceData.refreshToken = response.refreshToken;
  }
  var serviceData = {};
   serviceData.id = identity.sub;
   serviceData.username = identity.preferred_username;
   serviceData.accessToken = accessToken;
   serviceData.expiresAt = token.expires_in;
   serviceData.email = identity.email
   var profile = {};
    profile.name = identity.preferred_username;
    profile.email = identity.email;
  return {
    serviceData: serviceData,
    options: { profile: profile}
  };
});

var userAgent = "Meteor";
if (Meteor.release) {
  userAgent += "/" + Meteor.release;
}

const getToken = function (query) {
  var debug = false;
  var serverTokenEndpoint = "https://accounts.play.knowledge.io/token";
  var response;
  try {
    response = HTTP.post(
      serverTokenEndpoint,
      {
        params: {
          code: query.code,
          client_id: 'knowledge-code',
          client_secret: 'knowledge-code',
          redirect_uri: 'https://store.local.knowledge.io/_oauth/knowledge',
          grant_type: 'authorization_code'
        }
      }
    );
  } catch (err) {
    throw _.extend(new Error("Failed to get token from OIDC " + serverTokenEndpoint + ": " + err.message),
      { response: err.response });
  }
  if (response.data.error) {
    // if the http response was a json object with an error attribute
    throw new Error("Failed to complete handshake with OIDC " + serverTokenEndpoint + ": " + response.data.error);
  } else {
    if (debug) console.log('XXX: getToken response: ', response.content);
    return response;
  }
};
const getUserInfo = function (accessToken) {
  var debug = false;
  var serverUserinfoEndpoint = "https://accounts.play.knowledge.io/me";
  var response;
  try {
    response = HTTP.get(
      serverUserinfoEndpoint,
      {
        headers: {
          "User-Agent": userAgent,
          "Authorization": "Bearer " + accessToken
        }
      }
    );
  } catch (err) {
    throw _.extend(new Error("Failed to fetch userinfo from OIDC " + serverUserinfoEndpoint + ": " + err.message),
                   {response: err.response});
  }
  if (debug) console.log('XXX: getUserInfo response: ', response.content);
  return response.data;
};

const ifNull = function (val, def) {
  return val || def;
};


Knowledge.retrieveCredential = function (credentialToken, credentialSecret) {
  return Oauth.retrieveCredential(credentialToken, credentialSecret);
};

// override this method to set the root redirect URL
// useful for multi-tenant environments
Knowledge.rootUrl = function () { /* noop */ };

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function(){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                 //
// packages/knowledgeio_accounts-knowledge/knowledge.js                                                            //
//                                                                                                                 //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
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

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
Package._define("knowledgeio:accounts-knowledge", {
  getConfigProvider: getConfigProvider,
  Knowledge: Knowledge
});

})();
