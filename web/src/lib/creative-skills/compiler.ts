import { parseCreativeSkillRecipeV1 } from "./schema.ts";
import type {
    CompileCreativeSkillRecipeInput,
    CompiledCreativeSkillCallV1,
    CompiledCreativeSkillImageV1,
    CompiledCreativeSkillPlanV1,
    CreativeSkillParameterValue,
    CreativeSkillRecipeV1,
    CreativeSkillStepV1,
} from "./types.ts";

export function compileCreativeSkillRecipeV1(recipeValue: unknown, input: CompileCreativeSkillRecipeInput): CompiledCreativeSkillPlanV1 {
    const recipe = parseCreativeSkillRecipeV1(recipeValue);
    const parameterValues = resolveParameterValues(recipe, input.parameters);
    const calls = recipe.steps.flatMap((step, stepIndex) => compileStep(recipe, step, stepIndex, input, parameterValues));
    return {
        schemaVersion: 1,
        parameterValues,
        finalOutputCount: recipe.finalOutputCount,
        providerCallCount: calls.length,
        calls,
    };
}

function resolveParameterValues(recipe: CreativeSkillRecipeV1, supplied: Record<string, CreativeSkillParameterValue>) {
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new Error("创作 Skill 参数必须是对象");
    const declared = new Set(recipe.parameters.map((parameter) => parameter.key));
    const unknown = Object.keys(supplied).find((key) => !declared.has(key));
    if (unknown) throw new Error(`创作 Skill 包含未知参数：${unknown}`);
    return Object.fromEntries(recipe.parameters.map((parameter) => {
        const value = supplied[parameter.key] ?? parameter.default ?? "";
        const label = `参数 ${parameter.key}`;
        if (parameter.type === "text") {
            if (typeof value !== "string") throw new Error(`${label} 必须是文本`);
            if (parameter.required && !value.trim()) throw new Error(`${label} 为必填文本`);
            if (Array.from(value).length > (parameter.maxLength ?? 20_000)) throw new Error(`${label} 超过长度限制`);
        } else if (parameter.type === "enum") {
            if (typeof value !== "string") throw new Error(`${label} 必须是枚举文本`);
            if (parameter.required && !value) throw new Error(`${label} 为必填选项`);
            if (value && !parameter.options.some((option) => option.value === value)) throw new Error(`${label} 不是可用选项`);
        } else if (parameter.type === "integer") {
            if (value === "" && !parameter.required) return [parameter.key, value];
            if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${label} 必须是整数`);
            if (value < parameter.min || value > parameter.max) throw new Error(`${label} 超出范围`);
            if ((value - parameter.min) % parameter.step !== 0) throw new Error(`${label} 不符合步长`);
        } else {
            if (typeof value !== "string") throw new Error(`${label} 必须是画幅文本`);
            if (parameter.required && !value) throw new Error(`${label} 为必填选项`);
            if (value && value !== "auto" && !/^[1-9]\d{0,3}:[1-9]\d{0,3}$/.test(value)) throw new Error(`${label} 画幅格式无效`);
            if (value && parameter.options && !parameter.options.includes(value)) throw new Error(`${label} 不是可用选项`);
        }
        return [parameter.key, value];
    }));
}

function compileStep(
    recipe: CreativeSkillRecipeV1,
    step: CreativeSkillStepV1,
    stepIndex: number,
    input: CompileCreativeSkillRecipeInput,
    parameterValues: Record<string, CreativeSkillParameterValue>,
): CompiledCreativeSkillCallV1[] {
    const terminal = stepIndex === recipe.steps.length - 1;
    const outputCount = terminal ? recipe.finalOutputCount : 1;
    const images = compileImages(step, stepIndex, input);
    const prompt = step.prompt.map((segment) => segment.type === "literal" ? segment.text : String(parameterValues[segment.key] ?? "")).join("");
    return Array.from({ length: outputCount }, (_, outputIndex) => ({
        stepIndex,
        outputIndex,
        task: step.operation,
        prompt,
        images,
        options: { count: 1 },
        terminal,
    }));
}

function compileImages(step: CreativeSkillStepV1, stepIndex: number, input: CompileCreativeSkillRecipeInput): CompiledCreativeSkillImageV1[] {
    if (step.operation === "image.generate") return [];
    const target: CompiledCreativeSkillImageV1 | undefined = stepIndex
        ? { type: "step-output", stepIndex: stepIndex - 1, outputIndex: 0 }
        : input.target && { type: "input-target", sha256: input.target.sha256 };
    const images = [
        ...(target ? [target] : []),
        ...(step.references || []).flatMap<CompiledCreativeSkillImageV1>((reference) => {
            if (reference.type === "input-target") return input.target ? [{ type: "input-target", sha256: input.target.sha256 }] : [];
            if (reference.type === "input-references") return (input.references || []).map((image, index) => ({ type: "input-reference", index, sha256: image.sha256 }));
            return [{ type: "asset", sha256: reference.sha256 }];
        }),
    ];
    const seen = new Set<string>();
    return images.filter((image) => {
        const identity = image.type === "step-output"
            ? `${image.type}:${image.stepIndex}:${image.outputIndex}`
            : image.type === "input-reference"
              ? `${image.type}:${image.index}:${image.sha256}`
              : `${image.type}:${image.sha256}`;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
    });
}
