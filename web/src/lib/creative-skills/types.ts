export type Sha256 = string;

type ParameterBase = {
    key: string;
    label: string;
    description?: string;
    required: boolean;
};

export type CreativeSkillParameterV1 =
    | (ParameterBase & { type: "text"; default?: string; maxLength?: number })
    | (ParameterBase & { type: "enum"; options: Array<{ value: string; label: string }>; default?: string })
    | (ParameterBase & { type: "integer"; min: number; max: number; step: number; default?: number })
    | (ParameterBase & { type: "aspect-ratio"; options?: string[]; default?: string });

export type CreativeSkillPromptSegmentV1 =
    | { type: "literal"; text: string }
    | { type: "parameter"; key: string };

export type CreativeSkillReferenceV1 =
    | { type: "input-target" }
    | { type: "input-references" }
    | { type: "asset"; sha256: Sha256 };

export type CreativeSkillStepV1 = {
    operation: "image.generate" | "image.edit";
    prompt: CreativeSkillPromptSegmentV1[];
    references?: CreativeSkillReferenceV1[];
};

export type CreativeSkillRecipeV1 = {
    schemaVersion: 1;
    kind: "linear-image";
    parameters: CreativeSkillParameterV1[];
    steps: CreativeSkillStepV1[];
    finalOutputCount: number;
};

export type CreativeSkillParameterValue = string | number;
export type CreativeSkillImageInput = { sha256: Sha256 };

export type CompileCreativeSkillRecipeInput = {
    parameters: Record<string, CreativeSkillParameterValue>;
    target?: CreativeSkillImageInput;
    references?: CreativeSkillImageInput[];
};

export type CompiledCreativeSkillImageV1 =
    | { type: "input-target"; sha256: Sha256 }
    | { type: "input-reference"; index: number; sha256: Sha256 }
    | { type: "asset"; sha256: Sha256 }
    | { type: "step-output"; stepIndex: number; outputIndex: number };

export type CompiledCreativeSkillCallV1 = {
    stepIndex: number;
    outputIndex: number;
    task: CreativeSkillStepV1["operation"];
    prompt: string;
    images: CompiledCreativeSkillImageV1[];
    options: { count: 1 };
    terminal: boolean;
};

export type CompiledCreativeSkillPlanV1 = {
    schemaVersion: 1;
    parameterValues: Record<string, CreativeSkillParameterValue>;
    finalOutputCount: number;
    providerCallCount: number;
    calls: CompiledCreativeSkillCallV1[];
};
