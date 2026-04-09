import { CreateWireHandler } from "./handlers/create-wire.handler";
import { DeleteEntitiesHandler } from "./handlers/delete-entities.handler";
import { MoveEntitiesHandler } from "./handlers/move-entities.handler";
import { PlacePartHandler } from "./handlers/place-part.handler";
import { SetPartValueHandler } from "./handlers/set-part-value.handler";
import { CommandRegistry } from "./command-registry";

export function createDefaultCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(new PlacePartHandler());
  registry.register(new MoveEntitiesHandler());
  registry.register(new DeleteEntitiesHandler());
  registry.register(new SetPartValueHandler());
  registry.register(new CreateWireHandler());
  return registry;
}
