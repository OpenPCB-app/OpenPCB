import type { AssistantSDK } from "../../../sdks/assistant";
import { getAssistantService } from "./assistant-service";

export function buildAssistantSdk(): AssistantSDK {
  const service = getAssistantService();
  return {
    createChat: (input) => Promise.resolve(service.createChat(input)),
    listChats: () => Promise.resolve(service.store.listChats()),
    getChat: (chatId) => Promise.resolve(service.store.getChat(chatId)),
    listMessages: (chatId) => Promise.resolve(service.store.listMessages(chatId)),
    submitMessage: (chatId, input) => service.submitMessage(chatId, input),
    getSettings: () => Promise.resolve(service.getSettings()),
    updateSettings: (input) => Promise.resolve(service.updateSettings(input)),
    listProviders: () => Promise.resolve(service.listProviders()),
    createProvider: (input) => Promise.resolve(service.createProviderConfig(input)),
    updateProvider: (id, input) => Promise.resolve(service.updateProviderConfig(id, input)),
    deleteProvider: (id) => Promise.resolve(service.deleteProviderConfig(id)),
    listProviderModels: (id) => Promise.resolve(service.listProviderModels(id)),
    refreshProviderModels: (id) => service.refreshProviderModels(id),
    testProvider: (id, input) => service.testProvider(id, input),
  };
}
