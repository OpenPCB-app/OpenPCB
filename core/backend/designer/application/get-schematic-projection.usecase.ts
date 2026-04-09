import type { SchematicProjection } from "../contracts/projection";
import { buildSchematicProjection } from "../domain/projections/build-schematic-projection";
import type { DesignEntityRepository } from "../persistence/ports/design-entity.repository";
import type { DesignHeadRepository } from "../persistence/ports/design-head.repository";
import type { DesignNetMemberRepository } from "../persistence/ports/design-net-member.repository";
import { entityRecordToEntity, headRecordToState } from "./world-persistence.mapper";

interface GetProjectionDeps {
  headRepository: DesignHeadRepository;
  entityRepository: DesignEntityRepository;
  netMemberRepository: DesignNetMemberRepository;
}

export class GetSchematicProjectionUsecase {
  constructor(private deps: GetProjectionDeps) {}

  async execute(designId: string): Promise<SchematicProjection | null> {
    const head = await this.deps.headRepository.get(designId);
    if (!head) {
      return null;
    }

    const world = {
      head: headRecordToState(head),
      entities: new Map(
        (await this.deps.entityRepository.listByDesign(designId)).map((row) => [
          row.id,
          entityRecordToEntity(row),
        ]),
      ),
      netMembers: (await this.deps.netMemberRepository.listByDesign(designId)).map(
        (row) => ({
          netId: row.netId,
          memberEntityId: row.memberEntityId,
          memberKind: row.memberKind,
          pinKey: row.pinKey,
        }),
      ),
    };

    return buildSchematicProjection(world);
  }
}
