import type { DesignerCommand } from "../../contracts/commands/command-envelope";
import type { CommandHandler } from "./command-handler";

type HandlerMap = Map<DesignerCommand["type"], CommandHandler<DesignerCommand>>;

export class CommandRegistry {
  private handlers: HandlerMap = new Map();

  register<T extends DesignerCommand>(handler: CommandHandler<T>): void {
    this.handlers.set(
      handler.type,
      handler as unknown as CommandHandler<DesignerCommand>,
    );
  }

  get<T extends DesignerCommand["type"]>(type: T): CommandHandler<Extract<DesignerCommand, { type: T }>> {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No handler registered for command type: ${type}`);
    }
    return handler as unknown as CommandHandler<Extract<DesignerCommand, { type: T }>>;
  }
}
