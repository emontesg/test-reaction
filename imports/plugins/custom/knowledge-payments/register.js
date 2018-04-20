/* eslint camelcase: 0 */
import { Reaction } from "/server/api";

Reaction.registerPackage({
  label: "KnowledgePayment",
  name: "knowledge-paymentmethod",
  icon: "fa fa-credit-card-alt",
  autoEnable: true,
  settings: {
    "mode": false,
    "apiKey": "",
    "example": {
      enabled: true
    },
    "knowledge-paymentmethod": {
      enabled: true,
      support: [
        "Authorize",
        "Capture",
      ]
    }
  },
  registry: [
    // Settings panel
    {
      label: "Knowledge Payment", // this key (minus spaces) is used for translations
      provides: ["paymentSettings"],
      container: "dashboard",
      template: "knowledgeSettings"
    },

    // Payment form for checkout
    {
      template: "knowledgePaymentForm",
      provides: ["paymentMethod"],
      icon: "fa fa-credit-card-alt"
    }
  ]
});
