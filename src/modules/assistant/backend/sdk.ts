import type { AssistantSDK } from "../../../sdks/assistant";
import { getAssistantService } from "./assistant-service";

export function buildAssistantSdk(): AssistantSDK {
  return {
    createChat: (input) => Promise.resolve(getAssistantService().createChat(input)),
    listChats: () => Promise.resolve(getAssistantService().store.listChats()),
    getChat: (chatId) => Promise.resolve(getAssistantService().store.getChat(chatId)),
    listMessages: (chatId) => Promise.resolve(getAssistantService().store.listMessages(chatId)),
    submitMessage: (chatId, input) => getAssistantService().submitMessage(chatId, input),
    getSettings: () => Promise.resolve(getAssistantService().getSettings()),
    updateSettings: (input) => Promise.resolve(getAssistantService().updateSettings(input)),
    listProviders: () => Promise.resolve(getAssistantService().listProviders()),
    createProvider: (input) => Promise.resolve(getAssistantService().createProviderConfig(input)),
    updateProvider: (id, input) => Promise.resolve(getAssistantService().updateProviderConfig(id, input)),
    deleteProvider: (id) => Promise.resolve(getAssistantService().deleteProviderConfig(id)),
    listProviderModels: (id) => Promise.resolve(getAssistantService().listProviderModels(id)),
    refreshProviderModels: (id) => getAssistantService().refreshProviderModels(id),
    testProvider: (id, input) => getAssistantService().testProvider(id, input),
  };
}
