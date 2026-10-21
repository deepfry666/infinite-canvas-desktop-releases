import { App, Button, Drawer, Form, Input, InputNumber, Select, Switch } from "antd";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { parseCreativeSkillRecipeV1 } from "@/lib/creative-skills";
import type { CreativeSkillDefinition, CreativeSkillDraft, PatchCreativeSkillDraft } from "@/types/creative-skill";

type ParameterFormValue = {
    key: string;
    label: string;
    description?: string;
    required: boolean;
    type: "text" | "enum" | "integer" | "aspect-ratio";
    default?: string | number;
    maxLength?: number;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{ value: string; label: string }>;
};

type PromptSegmentFormValue = { type: "literal" | "parameter"; text?: string; key?: string };
type ReferenceFormValue = { type: "input-target" | "input-references" | "asset"; sha256?: string };
type StepFormValue = {
    operation: "image.generate" | "image.edit";
    prompt: PromptSegmentFormValue[];
    references?: ReferenceFormValue[];
};

type SkillRecipeFormValues = {
    name: string;
    description: string;
    finalOutputCount: number;
    parameters: ParameterFormValue[];
    steps: StepFormValue[];
};

export function SkillRecipeEditorDrawer({
    draft,
    open,
    saving,
    onClose,
    onSave,
}: {
    draft?: CreativeSkillDraft;
    open: boolean;
    saving: boolean;
    onClose: () => void;
    onSave: (patch: PatchCreativeSkillDraft) => Promise<void>;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [form] = Form.useForm<SkillRecipeFormValues>();

    useEffect(() => {
        if (!open || !draft) return;
        form.setFieldsValue(toFormValues(draft));
    }, [draft, form, open]);

    const save = async () => {
        try {
            const values = await form.validateFields();
            await onSave({
                name: values.name.trim(),
                description: values.description.trim(),
                definition: buildDefinition(values),
            });
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        }
    };

    return (
        <Drawer
            title={t("creativeSkills.editor.title")}
            open={open}
            onClose={onClose}
            size="large"
            destroyOnHidden
            footer={
                <div className="flex justify-end gap-2">
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" loading={saving} onClick={() => void save()}>{t("common.save")}</Button>
                </div>
            }
        >
            {draft ? (
                <Form form={form} layout="vertical" requiredMark="optional" initialValues={toFormValues(draft)}>
                    <EditorSection title={t("creativeSkills.editor.identity")} description={t("creativeSkills.editor.identityDescription")}>
                        <div className="grid gap-x-4 sm:grid-cols-2">
                            <Form.Item name="name" label={t("creativeSkills.fields.name")} rules={[{ required: true, whitespace: true, max: 120 }]}>
                                <Input maxLength={120} />
                            </Form.Item>
                            <Form.Item name="finalOutputCount" label={t("creativeSkills.editor.outputCount")} rules={[{ required: true }]}>
                                <InputNumber className="w-full" min={1} max={4} precision={0} />
                            </Form.Item>
                        </div>
                        <Form.Item name="description" label={t("creativeSkills.fields.description")} rules={[{ max: 1000 }]}>
                            <Input.TextArea maxLength={1000} autoSize={{ minRows: 2, maxRows: 5 }} />
                        </Form.Item>
                    </EditorSection>

                    <EditorSection title={t("creativeSkills.editor.parameters")} description={t("creativeSkills.editor.parametersDescription")}>
                        <Form.List name="parameters">
                            {(fields, { add, remove }) => (
                                <div>
                                    {fields.map((field, index) => (
                                        <ParameterFields key={field.key} field={field} index={index} form={form} remove={() => remove(field.name)} />
                                    ))}
                                    <Button
                                        type="text"
                                        icon={<Plus className="size-4" />}
                                        onClick={() => add({ key: "", label: "", required: false, type: "text", maxLength: 1200 })}
                                    >
                                        {t("creativeSkills.editor.addParameter")}
                                    </Button>
                                </div>
                            )}
                        </Form.List>
                    </EditorSection>

                    <EditorSection title={t("creativeSkills.editor.steps")} description={t("creativeSkills.editor.stepsDescription")} last>
                        <Form.List name="steps" rules={[{ validator: (_, steps) => steps?.length ? Promise.resolve() : Promise.reject(new Error(t("creativeSkills.editor.stepRequired"))) }]}>
                            {(fields, { add, remove }, { errors }) => (
                                <div>
                                    {fields.map((field, index) => (
                                        <StepFields key={field.key} field={field} index={index} form={form} remove={() => remove(field.name)} canRemove={fields.length > 1} />
                                    ))}
                                    <Form.ErrorList errors={errors} />
                                    <Button
                                        type="text"
                                        icon={<Plus className="size-4" />}
                                        disabled={fields.length >= 3}
                                        onClick={() => add({ operation: "image.edit", prompt: [{ type: "parameter", key: "user-request" }], references: [] })}
                                    >
                                        {t("creativeSkills.editor.addStep")}
                                    </Button>
                                </div>
                            )}
                        </Form.List>
                    </EditorSection>
                </Form>
            ) : null}
        </Drawer>
    );
}

function EditorSection({ title, description, last = false, children }: { title: string; description: string; last?: boolean; children: ReactNode }) {
    return (
        <section className={last ? "pt-6" : "border-b border-border pb-6 pt-1 first:pt-0"}>
            <h2 className="type-section-title text-[19px]">{title}</h2>
            <p className="mb-5 mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
            {children}
        </section>
    );
}

function ParameterFields({
    field,
    index,
    form,
    remove,
}: {
    field: { key: number; name: number };
    index: number;
    form: ReturnType<typeof Form.useForm<SkillRecipeFormValues>>[0];
    remove: () => void;
}) {
    const { t } = useTranslation();
    const type = Form.useWatch(["parameters", field.name, "type"], form) as ParameterFormValue["type"] | undefined;
    const key = Form.useWatch(["parameters", field.name, "key"], form) as string | undefined;
    return (
        <div className="mb-5 border-b border-border/70 pb-5 last:border-0">
            <div className="mb-3 flex items-center justify-between">
                <span className="type-label text-muted-foreground">{t("creativeSkills.editor.parameterNumber", { count: index + 1 })}</span>
                <Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} disabled={key === "user-request"} onClick={remove}>{t("common.delete")}</Button>
            </div>
            <div className="grid gap-x-3 sm:grid-cols-2">
                <Form.Item name={[field.name, "key"]} label={t("creativeSkills.editor.parameterKey")} rules={[{ required: true, pattern: /^[a-z][a-z0-9-]*$/, max: 64 }]}>
                    <Input disabled={key === "user-request"} placeholder="user-request" />
                </Form.Item>
                <Form.Item name={[field.name, "label"]} label={t("creativeSkills.editor.parameterLabel")} rules={[{ required: true, whitespace: true, max: 80 }]}>
                    <Input />
                </Form.Item>
                <Form.Item name={[field.name, "type"]} label={t("creativeSkills.editor.parameterType")} rules={[{ required: true }]}>
                    <Select disabled={key === "user-request"} options={[
                        { value: "text", label: t("creativeSkills.editor.parameterTypes.text") },
                        { value: "enum", label: t("creativeSkills.editor.parameterTypes.enum") },
                        { value: "integer", label: t("creativeSkills.editor.parameterTypes.integer") },
                        { value: "aspect-ratio", label: t("creativeSkills.editor.parameterTypes.aspectRatio") },
                    ]} />
                </Form.Item>
                <Form.Item name={[field.name, "required"]} label={t("creativeSkills.editor.required")} valuePropName="checked">
                    <Switch />
                </Form.Item>
            </div>
            <Form.Item name={[field.name, "description"]} label={t("creativeSkills.fields.description")} rules={[{ max: 500 }]}>
                <Input maxLength={500} />
            </Form.Item>
            {type === "text" ? (
                <div className="grid gap-x-3 sm:grid-cols-2">
                    <Form.Item name={[field.name, "default"]} label={t("creativeSkills.editor.defaultValue")}><Input /></Form.Item>
                    <Form.Item name={[field.name, "maxLength"]} label={t("creativeSkills.editor.maxLength")}><InputNumber className="w-full" min={1} max={20_000} precision={0} /></Form.Item>
                </div>
            ) : null}
            {type === "integer" ? (
                <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-4">
                    <Form.Item name={[field.name, "min"]} label={t("creativeSkills.editor.min")} rules={[{ required: true }]}><InputNumber className="w-full" precision={0} /></Form.Item>
                    <Form.Item name={[field.name, "max"]} label={t("creativeSkills.editor.max")} rules={[{ required: true }]}><InputNumber className="w-full" precision={0} /></Form.Item>
                    <Form.Item name={[field.name, "step"]} label={t("creativeSkills.editor.step")} rules={[{ required: true }]}><InputNumber className="w-full" min={1} precision={0} /></Form.Item>
                    <Form.Item name={[field.name, "default"]} label={t("creativeSkills.editor.defaultValue")}><InputNumber className="w-full" precision={0} /></Form.Item>
                </div>
            ) : null}
            {type === "enum" ? <EnumOptions fieldName={field.name} /> : null}
            {type === "aspect-ratio" ? (
                <div className="grid gap-x-3 sm:grid-cols-2">
                    <Form.Item name={[field.name, "options"]} label={t("creativeSkills.editor.ratioOptions")} getValueFromEvent={(values: string[]) => values?.map((value) => ({ value, label: value }))} getValueProps={(values?: Array<{ value: string }>) => ({ value: values?.map((item) => item.value) || [] })}>
                        <Select mode="tags" tokenSeparators={[","]} placeholder="1:1, 4:5, 16:9" />
                    </Form.Item>
                    <Form.Item name={[field.name, "default"]} label={t("creativeSkills.editor.defaultValue")}><Input placeholder="auto" /></Form.Item>
                </div>
            ) : null}
        </div>
    );
}

function EnumOptions({ fieldName }: { fieldName: number }) {
    const { t } = useTranslation();
    return (
        <Form.List name={[fieldName, "options"]}>
            {(fields, { add, remove }) => (
                <div>
                    <div className="mb-2 type-label text-muted-foreground">{t("creativeSkills.editor.enumOptions")}</div>
                    {fields.map((option) => (
                        <div key={option.key} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                            <Form.Item className="mb-0" name={[option.name, "value"]} rules={[{ required: true, max: 80 }]}><Input placeholder={t("creativeSkills.editor.optionValue")} /></Form.Item>
                            <Form.Item className="mb-0" name={[option.name, "label"]} rules={[{ required: true, max: 80 }]}><Input placeholder={t("creativeSkills.editor.optionLabel")} /></Form.Item>
                            <Button type="text" danger icon={<Trash2 className="size-3.5" />} aria-label={t("common.delete")} onClick={() => remove(option.name)} />
                        </div>
                    ))}
                    <Button type="text" size="small" icon={<Plus className="size-3.5" />} onClick={() => add({ value: "", label: "" })}>{t("creativeSkills.editor.addOption")}</Button>
                    <Form.Item name={[fieldName, "default"]} label={t("creativeSkills.editor.defaultValue")} className="mt-3"><Input /></Form.Item>
                </div>
            )}
        </Form.List>
    );
}

function StepFields({
    field,
    index,
    form,
    remove,
    canRemove,
}: {
    field: { key: number; name: number };
    index: number;
    form: ReturnType<typeof Form.useForm<SkillRecipeFormValues>>[0];
    remove: () => void;
    canRemove: boolean;
}) {
    const { t } = useTranslation();
    const operation = Form.useWatch(["steps", field.name, "operation"], form) as StepFormValue["operation"] | undefined;
    const parameterOptions = (Form.useWatch("parameters", form) || []).flatMap((parameter: ParameterFormValue) => parameter?.key ? [{ value: parameter.key, label: parameter.label || parameter.key }] : []);
    return (
        <div className="mb-6 border-b border-border/70 pb-6 last:border-0">
            <div className="mb-3 flex items-center justify-between">
                <span className="type-label text-muted-foreground">{t("creativeSkills.editor.stepNumber", { count: index + 1 })}</span>
                <Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} disabled={!canRemove} onClick={remove}>{t("common.delete")}</Button>
            </div>
            <Form.Item name={[field.name, "operation"]} label={t("creativeSkills.editor.operation")} rules={[{ required: true }]}>
                <Select
                    options={index === 0 ? [
                        { value: "image.generate", label: t("creativeSkills.editor.operations.generate") },
                        { value: "image.edit", label: t("creativeSkills.editor.operations.edit") },
                    ] : [{ value: "image.edit", label: t("creativeSkills.editor.operations.edit") }]}
                    onChange={(value) => {
                        if (value === "image.generate") form.setFieldValue(["steps", field.name, "references"], []);
                    }}
                />
            </Form.Item>
            <div className="mb-2 type-label text-muted-foreground">{t("creativeSkills.editor.promptSegments")}</div>
            <Form.List name={[field.name, "prompt"]}>
                {(segments, { add, remove: removeSegment }) => (
                    <div className="mb-4">
                        {segments.map((segment) => (
                            <PromptSegmentFields key={segment.key} stepName={field.name} segment={segment} parameterOptions={parameterOptions} remove={() => removeSegment(segment.name)} />
                        ))}
                        <Button type="text" size="small" icon={<Plus className="size-3.5" />} onClick={() => add({ type: "literal", text: "" })}>{t("creativeSkills.editor.addPromptSegment")}</Button>
                    </div>
                )}
            </Form.List>
            {operation === "image.edit" ? (
                <>
                    <div className="mb-2 type-label text-muted-foreground">{t("creativeSkills.editor.references")}</div>
                    <Form.List name={[field.name, "references"]}>
                        {(references, { add, remove: removeReference }) => (
                            <div>
                                {references.map((reference) => (
                                    <ReferenceFields key={reference.key} stepName={field.name} reference={reference} form={form} remove={() => removeReference(reference.name)} />
                                ))}
                                <Button type="text" size="small" icon={<Plus className="size-3.5" />} onClick={() => add({ type: "input-references" })}>{t("creativeSkills.editor.addReference")}</Button>
                            </div>
                        )}
                    </Form.List>
                </>
            ) : null}
        </div>
    );
}

function PromptSegmentFields({ stepName, segment, parameterOptions, remove }: { stepName: number; segment: { key: number; name: number }; parameterOptions: Array<{ value: string; label: string }>; remove: () => void }) {
    const { t } = useTranslation();
    return (
        <Form.Item noStyle shouldUpdate={(previous, current) => previous.steps?.[stepName]?.prompt?.[segment.name]?.type !== current.steps?.[stepName]?.prompt?.[segment.name]?.type}>
            {({ getFieldValue }) => {
                const type = getFieldValue(["steps", stepName, "prompt", segment.name, "type"]);
                return (
                    <div className="mb-2 grid grid-cols-[9rem_1fr_auto] gap-2">
                        <Form.Item className="mb-0" name={[segment.name, "type"]} rules={[{ required: true }]}>
                            <Select options={[
                                { value: "literal", label: t("creativeSkills.editor.segmentTypes.literal") },
                                { value: "parameter", label: t("creativeSkills.editor.segmentTypes.parameter") },
                            ]} />
                        </Form.Item>
                        {type === "parameter" ? (
                            <Form.Item className="mb-0" name={[segment.name, "key"]} rules={[{ required: true }]}><Select options={parameterOptions} /></Form.Item>
                        ) : (
                            <Form.Item className="mb-0" name={[segment.name, "text"]} rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
                        )}
                        <Button type="text" danger icon={<Trash2 className="size-3.5" />} aria-label={t("common.delete")} onClick={remove} />
                    </div>
                );
            }}
        </Form.Item>
    );
}

function ReferenceFields({ stepName, reference, form, remove }: { stepName: number; reference: { key: number; name: number }; form: ReturnType<typeof Form.useForm<SkillRecipeFormValues>>[0]; remove: () => void }) {
    const { t } = useTranslation();
    const type = Form.useWatch(["steps", stepName, "references", reference.name, "type"], form) as ReferenceFormValue["type"] | undefined;
    return (
        <div className="mb-2 grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[14rem_1fr_auto]">
            <Form.Item className="mb-0" name={[reference.name, "type"]} rules={[{ required: true }]}>
                <Select options={[
                    { value: "input-target", label: t("creativeSkills.editor.referenceTypes.target") },
                    { value: "input-references", label: t("creativeSkills.editor.referenceTypes.references") },
                    { value: "asset", label: t("creativeSkills.editor.referenceTypes.asset") },
                ]} />
            </Form.Item>
            {type === "asset" ? <Form.Item className="mb-0" name={[reference.name, "sha256"]} rules={[{ required: true }]}><Input placeholder="sha256" /></Form.Item> : <span className="hidden sm:block" />}
            <Button type="text" danger icon={<Trash2 className="size-3.5" />} aria-label={t("common.delete")} onClick={remove} />
        </div>
    );
}

function toFormValues(draft: CreativeSkillDraft): SkillRecipeFormValues {
    return {
        name: draft.name,
        description: draft.description,
        finalOutputCount: draft.definition.finalOutputCount,
        parameters: draft.definition.parameters.map((parameter) => parameter.type === "aspect-ratio"
            ? { ...structuredClone(parameter), options: parameter.options?.map((value) => ({ value, label: value })) }
            : structuredClone(parameter)),
        steps: structuredClone(draft.definition.steps),
    };
}

function buildDefinition(values: SkillRecipeFormValues): CreativeSkillDefinition {
    const parameters = values.parameters.map((parameter) => {
        const common = {
            key: parameter.key.trim(),
            label: parameter.label.trim(),
            ...(parameter.description?.trim() ? { description: parameter.description.trim() } : {}),
            required: Boolean(parameter.required),
        };
        if (parameter.type === "text") return { ...common, type: "text" as const, ...(typeof parameter.default === "string" ? { default: parameter.default } : {}), ...(parameter.maxLength ? { maxLength: parameter.maxLength } : {}) };
        if (parameter.type === "enum") return { ...common, type: "enum" as const, options: (parameter.options || []).map((option) => ({ value: option.value.trim(), label: option.label.trim() })), ...(typeof parameter.default === "string" ? { default: parameter.default } : {}) };
        if (parameter.type === "integer") return { ...common, type: "integer" as const, min: parameter.min!, max: parameter.max!, step: parameter.step!, ...(typeof parameter.default === "number" ? { default: parameter.default } : {}) };
        return { ...common, type: "aspect-ratio" as const, ...(parameter.options?.length ? { options: parameter.options.map((option) => option.value.trim()) } : {}), ...(typeof parameter.default === "string" && parameter.default ? { default: parameter.default.trim() } : {}) };
    });
    const steps = values.steps.map((step) => ({
        operation: step.operation,
        prompt: step.prompt.map((segment) => segment.type === "parameter"
            ? { type: "parameter" as const, key: segment.key!.trim() }
            : { type: "literal" as const, text: segment.text! }),
        ...(step.references?.length ? { references: step.references.map((reference) => reference.type === "asset" ? { type: "asset" as const, sha256: reference.sha256!.trim() } : { type: reference.type }) } : {}),
    }));
    return parseCreativeSkillRecipeV1({ schemaVersion: 1, kind: "linear-image", parameters, steps, finalOutputCount: values.finalOutputCount });
}
