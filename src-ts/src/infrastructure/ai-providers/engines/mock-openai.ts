// Mock for openai
export default class OpenAI {
  chat: any;
  models: any;
  constructor(config: any) {
    this.chat = {
      completions: {
        create: async () => ({
          choices: [{ message: { content: "Mock response" } }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        })
      }
    };
    this.models = { list: async () => ({}) };
  }
}
