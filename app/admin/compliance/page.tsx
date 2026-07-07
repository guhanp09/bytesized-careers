import { PlannedModule } from "../../../components/admin/ui";

export const dynamic = "force-dynamic";

/**
 * Compliance is deliberately a Planned section (docs/ADMIN_PANEL_PLAN.md §7.8):
 * the deletion/export pipeline is a product feature that doesn't exist yet, and
 * faking it here would be worse than showing the roadmap honestly.
 */
export default function AdminCompliancePage() {
  return (
    <div className="space-y-3" data-testid="admin-compliance">
      <PlannedModule
        title="Account deletion requests"
        description="Queue of user-initiated deletion requests: verify the requester, run the grace window, then anonymize across tables (reports and audit entries keep pseudonymous references)."
        dependencies={["deletion-request model", "user-facing request flow", "anonymization strategy per table"]}
      />
      <PlannedModule
        title="Data export requests"
        description="Self-serve export monitoring once the user-facing export exists in Settings."
        dependencies={["export pipeline", "settings entry point"]}
      />
      <PlannedModule
        title="Retention & legal hold"
        description="Retention log and legal-hold overrides for content involved in open disputes."
        dependencies={["retention policy decision", "hold model"]}
      />
      <PlannedModule
        title="Appeals"
        description="A user-facing appeal flow on moderation decisions. Every enforcement action already records actor, reason, and evidence — exactly what an appeal review needs — so this is UI + a queue, not a data-model change."
        dependencies={["user-facing appeal entry point", "appeal queue"]}
      />
      <PlannedModule
        title="Block / mute visibility"
        description="Read-only visibility into user blocks as a safety signal once the user-facing block/mute feature ships. Admins will not create blocks."
        dependencies={["user-facing block/mute feature"]}
      />
    </div>
  );
}
