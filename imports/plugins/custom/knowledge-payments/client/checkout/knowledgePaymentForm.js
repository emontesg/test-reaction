import { Meteor } from "meteor/meteor";
import { Template } from "meteor/templating";
import { Reaction } from "/client/api";
import { Cart, Shops, Packages } from "/lib/collections";
// import { Example } from "../../lib/api";
// import { ExamplePayment } from "../../lib/collections/schemas";

import "./knowledgePaymentForm.jade";

Template.knowledgePaymentForm.events({
  'click .btn-complete-order': function(event){
    console.log('click .btn-complete-order');
    event.preventDefault();
    var infoPay = {
      total : Number(Cart.findOne().getTotal()),
      currency : Shops.findOne().currency
    };
    Meteor.call('knoledgePayments/authorize', infoPay, function(error, result){
      if(error){
        console.error(error);
        FlashMessages.sendError(error.error);
      } else {
        console.log('Result', result);

        Meteor.subscribe("Packages", Reaction.getShopId());
        const packageData = Packages.findOne({
          name: "knowledge-paymentmethod",
          shopId: Reaction.getShopId()
        });

        console.log('PackageData', packageData);

        Meteor.call("cart/submitPayment", {
          processor: "Knowledge",
          paymentPackageId: packageData._id,
          paymentSettingsKey: packageData.registry[0].settingsKey,
          transactionId: 'tbd',
          currency: infoPay.currency,
          amount: infoPay.total,
          status: 'completed',
          mode: "authorize",
          createdAt: new Date(),
          transactions: [infoPay]
        });
      }
    });
  }
});
