import { Template } from "meteor/templating";
import { KnowledgeSettingsFormContainer } from "../containers";
import "./knowledgeSettings.html";

Template.knowledgeSettings.helpers({
  ExampleSettings() {
    return {
      component: KnowledgeSettingsFormContainer
    };
  }
});
