import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { GuideOut } from "@sops/shared";
import { useReorderSteps } from "../hooks/useGuide";
import StepCard from "./StepCard";

export default function StepList({ guide }: { guide: GuideOut }) {
  const reorder = useReorderSteps(guide.id);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const stepIds = guide.steps.map((s) => s.id);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = arrayMove(
      stepIds,
      stepIds.indexOf(String(active.id)),
      stepIds.indexOf(String(over.id)),
    );
    reorder.mutate(next);
  };

  if (guide.steps.length === 0) {
    return <p className="text-zinc-500">This guide has no steps.</p>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-4">
          {guide.steps.map((step, index) => (
            <StepCard key={step.id} guideId={guide.id} step={step} index={index} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
