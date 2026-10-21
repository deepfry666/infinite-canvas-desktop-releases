import type { CreativeSkillRunRequest } from "../creative-skill-runner.ts";
import type { AgentCreativeSkillExecution } from "../../stores/use-agent-store.ts";

export function buildCanvasCreativeSkillRunRequest({
    execution,
    projectId,
    target,
    references,
    assets,
    provider,
}: {
    execution: AgentCreativeSkillExecution;
    projectId: string;
    target?: CreativeSkillRunRequest["target"];
    references: CreativeSkillRunRequest["references"];
    assets: CreativeSkillRunRequest["assets"];
    provider: CreativeSkillRunRequest["provider"];
}): CreativeSkillRunRequest {
    return {
        commandId: execution.commandId,
        mode: execution.mode,
        skill: {
            skillId: execution.skill.skillId,
            versionId: execution.skill.versionId,
            definitionHash: execution.skill.definitionHash,
            nameSnapshot: execution.skill.name,
            ...(execution.skill.source === undefined ? {} : { source: execution.skill.source }),
        },
        origin: { projectId, anchorNodeId: execution.anchorNodeId, threadId: execution.threadId, clientMessageId: execution.clientMessageId },
        recipe: execution.recipe,
        parameters: execution.parameters,
        target,
        references,
        assets,
        provider,
    };
}
