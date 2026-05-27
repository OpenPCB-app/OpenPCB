import type { AssistantSDK } from "../../../sdks/assistant";
import { getAssistantService } from "./assistant-service";

export function buildAssistantSdk(): AssistantSDK {
  return {
    createChat: (input) =>
      Promise.resolve(getAssistantService().createChat(input)),
    listChats: () =>
      Promise.resolve(getAssistantService().conversation.listChats()),
    getChat: (chatId) =>
      Promise.resolve(getAssistantService().conversation.getChat(chatId)),
    deleteChat: (chatId) => {
      getAssistantService().conversation.deleteChat(chatId);
      return Promise.resolve();
    },
    listMessages: (chatId, options) =>
      Promise.resolve(
        getAssistantService().conversation.listMessages(chatId, options),
      ),
    submitMessage: (chatId, input) =>
      getAssistantService().submitMessage(chatId, input),

    listPromptPresets: () =>
      Promise.resolve(getAssistantService().listPromptPresets()),

    listContextBindings: (chatId) =>
      Promise.resolve(getAssistantService().listContextBindings(chatId)),
    deleteContextBinding: (chatId, bindingId) => {
      getAssistantService().deleteContextBinding(chatId, bindingId);
      return Promise.resolve();
    },

    listToolEvents: (chatId, options) =>
      Promise.resolve(getAssistantService().listToolEvents(chatId, options)),

    listWriteProposals: (chatId) =>
      Promise.resolve(getAssistantService().listWriteProposals(chatId)),
    applyWriteProposal: (chatId, proposalId, input) =>
      getAssistantService().applyWriteProposal(chatId, proposalId, input) as ReturnType<
        AssistantSDK["applyWriteProposal"]
      >,
    rejectWriteProposal: (chatId, proposalId) =>
      Promise.resolve(
        getAssistantService().rejectWriteProposal(chatId, proposalId),
      ),

    getSettings: () => Promise.resolve(getAssistantService().getSettings()),
    updateSettings: (input) =>
      Promise.resolve(getAssistantService().updateSettings(input)),

    listProviders: () => Promise.resolve(getAssistantService().listProviders()),
    createProvider: (input) =>
      Promise.resolve(getAssistantService().createProvider(input)),
    updateProvider: (id, input) =>
      Promise.resolve(getAssistantService().updateProvider(id, input)),
    deleteProvider: (id) =>
      Promise.resolve(getAssistantService().deleteProvider(id)),
    listProviderModels: (id) =>
      Promise.resolve(getAssistantService().listProviderModels(id)),
    refreshProviderModels: (id) =>
      getAssistantService().refreshProviderModels(id),
    testProvider: (id, input) => getAssistantService().testProvider(id, input),
    getProviderCapabilities: (id) =>
      Promise.resolve(getAssistantService().getProviderCapabilities(id)),
    refreshProviderCapabilities: (id) =>
      getAssistantService().refreshProviderCapabilities(id),
  };
}
