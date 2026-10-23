/* FORGEDTITANIUM Agent Command Centre: PUBLIC register for the static preview.
   Derived from the evidence-based register with internal approvals, allowances, key names,
   integration branches and reconciliation notes removed. Contains no operational readings. */
(function (root) {
  'use strict';
  const REGISTER_CONFIG = {
  "release": "ACC-R013-public",
  "TI_INTEGRATION": null,
  "inspected_at_utc": "2026-10-23T04:57:58Z",
  "EVIDENCE": [
    {
      "ref": "EV-TI-01",
      "source": "smitblade-dot/Travel_Intelligence, branch main, commit 1592f65 (committed 2026-10-23T01:55:12Z)",
      "note": "Public repository cloned read-only for ACC-R008 at 2026-10-23T04:57:58Z. Nothing was written to it."
    },
    {
      "ref": "EV-TI-02",
      "source": "docs/TI_OPS_DIRECTOR.md (completion record 21 Oct 2026); config/ops_director.example.json",
      "note": "Master Agent scope, five-stage status, spending gateway and limits."
    },
    {
      "ref": "EV-TI-03",
      "source": "docs/TI_COUNTRY_INTELLIGENCE_BUILDER.md; config/country_builder.json",
      "note": "Country builder operating model (publish), scope and proposed budget."
    },
    {
      "ref": "EV-TI-04",
      "source": "docs/TI_PRODUCTION_CONTROLLER.md; config/production_controller.json",
      "note": "Production controller operating configuration (observe)."
    },
    {
      "ref": "EV-TI-05",
      "source": "data/continuous_monitor_state.json, lastOutcome at 2026-10-23T01:55:12Z",
      "note": "Haiku monitor through the Master Agent spending gateway: dry run, limits null, publication unset."
    },
    {
      "ref": "EV-TI-06",
      "source": "docs/AGENT_BUILD_STANDARD.md",
      "note": "Defines the five stages: built, tested, merged, configured, operational."
    },
    {
      "ref": "EV-TI-07",
      "source": "main commit history, 22 Oct 2026",
      "note": "Builder publication commits at 14:27, 18:12, 20:20 and 21:06 UTC; PRs #40 to #43 merged."
    },
    {
      "ref": "EV-ORG-01",
      "source": "Organisational records",
      "note": "No approved organisational chart was available to the register, so Level 2 labels remain provisional."
    }
  ],
  "STREAMS": [
    {
      "id": "00",
      "name": "FORGEDTITANIUM",
      "color": "#62cfff",
      "sub": [],
      "note": "Company-wide overview. Six streams sit beneath this level. This is not a separate management stream."
    },
    {
      "id": "01",
      "name": "Travel Intelligence",
      "color": "#17aaff",
      "name_status": "provisional",
      "sub": [
        {
          "label": "Travel Intelligence Platform",
          "status": "provisional"
        },
        {
          "label": "Country Intelligence",
          "status": "provisional"
        },
        {
          "label": "Travel Security & Risk",
          "status": "provisional"
        },
        {
          "label": "Corporate & Project Intelligence",
          "status": "provisional"
        },
        {
          "label": "Alerts & Monitoring",
          "status": "provisional"
        },
        {
          "label": "Commercial Subscriptions",
          "status": "provisional"
        }
      ],
      "note": "Level 2 labels remain provisional: no approved Level 2 chart was accessible (EV-ORG-01). The TI repository calls Travel Intelligence a business application of 03AA-04."
    },
    {
      "id": "02",
      "name": "Quality Solutions",
      "color": "#ffab36",
      "name_status": "provisional",
      "sub": [
        {
          "label": "QC & Inspection Management Consultancy",
          "status": "provisional"
        },
        {
          "label": "Project Quality Management Consultancy",
          "status": "provisional"
        },
        {
          "label": "Vendor Management & Compliance",
          "status": "provisional"
        }
      ],
      "note": "Only known names shown; remaining positions require reconciliation. All provisional (EV-ORG-01)."
    },
    {
      "id": "03",
      "name": "Agents & Automation",
      "color": "#a76bff",
      "name_status": "corroborated",
      "name_evidence": "EV-TI-02",
      "sub": [
        {
          "label": "Agent SQE",
          "code": "03AA-01",
          "status": "provisional"
        },
        {
          "label": "Project Quality Agent",
          "code": "03AA-02",
          "status": "provisional"
        },
        {
          "label": "Venture Engine Agent",
          "code": "03AA-03",
          "status": "provisional"
        },
        {
          "label": "Intelligence Automation Agents",
          "code": "03AA-04",
          "status": "corroborated",
          "evidence": "EV-TI-02"
        },
        {
          "label": "Business Operations Agents",
          "status": "provisional"
        },
        {
          "label": "Agent Development Framework",
          "status": "provisional"
        }
      ],
      "note": "Development and ownership location for agents. Stream name and 03AA-04 Intelligence Automation Agents are corroborated by the TI repository; the other entries remain provisional."
    },
    {
      "id": "04",
      "name": "The Mester’s Forge",
      "color": "#ffd166",
      "name_status": "provisional",
      "sub": [
        {
          "label": "Children’s Colouring Books",
          "status": "provisional"
        },
        {
          "label": "Engineering Storybooks",
          "status": "provisional"
        },
        {
          "label": "Educational Activity Books",
          "status": "provisional"
        },
        {
          "label": "Characters & IP",
          "status": "provisional"
        },
        {
          "label": "Digital Publishing",
          "status": "provisional"
        },
        {
          "label": "Vendor Quality Toolkit / Inspection & Test Planning Templates (placement to verify)",
          "status": "provisional"
        }
      ],
      "note": "Final Level 2 numbering and placement must be verified against the latest approved chart."
    },
    {
      "id": "05",
      "name": "OSINT Dashboards",
      "color": "#3ef3a1",
      "name_status": "provisional",
      "sub": [
        {
          "label": "Oil Flow Dashboard",
          "status": "provisional"
        },
        {
          "label": "Gas & LNG Flow Dashboard",
          "status": "provisional"
        },
        {
          "label": "Energy Infrastructure Monitoring",
          "status": "provisional"
        },
        {
          "label": "Nuclear Intelligence",
          "status": "provisional"
        }
      ],
      "note": "Known dashboard activities shown; approved sub-stream register not yet confirmed."
    },
    {
      "id": "06",
      "name": "Venture Engine",
      "color": "#ff5abb",
      "name_status": "provisional",
      "sub": [
        {
          "label": "Opportunity Board",
          "status": "provisional"
        },
        {
          "label": "Venture Development",
          "status": "provisional"
        },
        {
          "label": "Monetisation Engine",
          "status": "provisional"
        },
        {
          "label": "Micro-SaaS",
          "status": "provisional"
        },
        {
          "label": "Licensing & IP",
          "status": "provisional"
        },
        {
          "label": "Partnerships",
          "status": "provisional"
        }
      ],
      "note": "AIBC is a trading name within 06VE-02VD, not an additional sub-stream (R006 note; not independently verified)."
    }
  ],
  "AGENTS": [
    {
      "name": "TI Operations Director (Master Agent)",
      "code": "03AA-04_Master_Agent_TI_Ops_Director",
      "interim_id": "ti-director",
      "verification": "verified",
      "evidence": [
        "EV-TI-01",
        "EV-TI-02",
        "EV-TI-05"
      ],
      "home": "03AA-04",
      "stream": "01",
      "master": true,
      "repo_role": "Controller (Master Agent)",
      "position": "Implemented; dry-run reported",
      "responsibilities": [
        "Coordinates Travel Intelligence work through one task queue with leases, pause and stop",
        "Runs the feed_health_diagnostic worker",
        "Spending gateway: reserves every paid model call against per-task, daily and monthly limits",
        "Runs the continuous Haiku monitor as one of its functions (decision ID-12), routed through the gateway; publication fails closed",
        "9 workers registered, 2 implemented (feed_health_diagnostic, production_verification)"
      ],
      "stages": {
        "built": "Yes: controller, feed-health worker, spending gateway, gated Haiku monitor.",
        "tested": "160 offline tests and PR checks green (repo record); approved live Haiku evaluation 21 Oct 2026, 16 calls, about EUR 0.0024.",
        "merged": "PR #27, commit 26e8321, 21 Oct 2026.",
        "configured": "Dry run on; TI_OPS per-task, daily and monthly limits unset, so paid calls are blocked; TI_MONITOR_PUBLISH unset.",
        "operational": "Queue daemon not deployed (no workflow runs the queue). The gated monitor runs on GitHub Actions every 15 min in dry run; last recorded outcome NOT_RUN_DRY_RUN at 01:55 UTC 23 Oct 2026."
      },
      "integration": {
        "state": "none",
        "note": "Reporting is disabled and not connected. This public preview shows no live agent data."
      },
      "controls": {
        "model_permissions": {
          "code": "permitted",
          "haiku": "permitted_within_allowance",
          "sonnet": "escalation_with_reason",
          "opus": "approval_required"
        },
        "permissions_basis": "Programme routing rule (default).",
        "allowance_eur": {
          "per_task": null,
          "daily": null,
          "monthly": null,
          "period_time_zone": "Europe/Nicosia",
          "approved_by": null,
          "approved_at": null,
          "approval_reference": null
        },
        "approval_requirements": [
          "Paid or live execution requires an approved allowance.",
          "Opus requires the owner’s approval of a defined task and allowance."
        ],
        "source_limits": "Not shown in the public preview."
      }
    },
    {
      "name": "Country Intelligence Builder",
      "code": "03AA-04_Country_Intelligence_Builder_TI",
      "interim_id": "ti-country-builder",
      "verification": "verified",
      "evidence": [
        "EV-TI-01",
        "EV-TI-03",
        "EV-TI-07"
      ],
      "home": "03AA-04",
      "stream": "01",
      "repo_role": "Master Agent worker country_content_builder",
      "position": "Development / publication integration",
      "responsibilities": [
        "Finds missing or stale country/category records in data.json",
        "Collects evidence from register-approved sources and applies the TI publication rules",
        "Publishes rule-passing content automatically and verifies it on the live site",
        "Holds exceptions with reasons and routes them to the Master Agent queue"
      ],
      "stages": {
        "built": "Yes: gap detection, evidence collection, publication rules, compare-and-swap publication, live-site verification, exception routing.",
        "tested": "Repo contains country builder, evaluation and publication test suites; not executed by the ACC.",
        "merged": "On main; latest changes PRs #40 to #43, 22 Oct 2026.",
        "configured": "Mode publish (committed, the owner 22 Oct 2026). Scope Ghana: ENVIRONMENT, TRANSPORT, EQUIPMENT. Expansion disabled. Model path awaiting budget authorisation.",
        "operational": "Four publication commits on main on 22 Oct 2026 (14:27 to 21:06 UTC). Scheduled slot is 05:41 UTC daily; no scheduled-slot run had occurred in publish mode at inspection. Trigger type of the 22 Oct runs not confirmable without Actions access. Automatic operation UNVERIFIED."
      },
      "integration": {
        "state": "none",
        "note": "Reporting is disabled and not connected. This public preview shows no live agent data."
      },
      "controls": {
        "model_permissions": {
          "code": "permitted",
          "haiku": "permitted_within_allowance",
          "sonnet": "escalation_with_reason",
          "opus": "approval_required"
        },
        "permissions_basis": "Programme routing rule (default).",
        "allowance_eur": {
          "per_task": null,
          "daily": null,
          "monthly": null,
          "period_time_zone": "Europe/Nicosia",
          "approved_by": null,
          "approved_at": null,
          "approval_reference": null
        },
        "approval_requirements": [
          "Paid or live execution requires an approved allowance.",
          "Opus requires the owner’s approval of a defined task and allowance."
        ],
        "source_limits": "Not shown in the public preview."
      }
    },
    {
      "name": "Global OSINT Discovery Agent",
      "code": null,
      "interim_id": "ti-osint-discovery",
      "verification": "not_evidenced",
      "evidence": [
        "EV-TI-01"
      ],
      "home": "03AA-04",
      "stream": "01",
      "position": "Status unverified",
      "responsibilities": [
        "Not evidenced in the TI repository."
      ],
      "stages": {
        "built": "Not evidenced",
        "tested": "Not evidenced",
        "merged": "Not evidenced",
        "configured": "Not evidenced",
        "operational": "Not evidenced"
      },
      "integration": {
        "state": "none",
        "note": "Reporting is disabled and not connected. This public preview shows no live agent data."
      },
      "controls": {
        "model_permissions": {
          "code": "permitted",
          "haiku": "permitted_within_allowance",
          "sonnet": "escalation_with_reason",
          "opus": "approval_required"
        },
        "permissions_basis": "Programme routing rule (default).",
        "allowance_eur": {
          "per_task": null,
          "daily": null,
          "monthly": null,
          "period_time_zone": "Europe/Nicosia",
          "approved_by": null,
          "approved_at": null,
          "approval_reference": null
        },
        "approval_requirements": [
          "Paid or live execution requires an approved allowance.",
          "Opus requires the owner’s approval of a defined task and allowance."
        ],
        "source_limits": "Not shown in the public preview."
      }
    },
    {
      "name": "Intelligence Analyst & Publisher",
      "code": null,
      "interim_id": "ti-analyst-publisher",
      "verification": "not_evidenced",
      "evidence": [
        "EV-TI-01"
      ],
      "home": "03AA-04",
      "stream": "01",
      "position": "Status unverified",
      "responsibilities": [
        "Not evidenced in the TI repository."
      ],
      "stages": {
        "built": "Not evidenced",
        "tested": "Not evidenced",
        "merged": "Not evidenced",
        "configured": "Not evidenced",
        "operational": "Not evidenced"
      },
      "integration": {
        "state": "none",
        "note": "Reporting is disabled and not connected. This public preview shows no live agent data."
      },
      "controls": {
        "model_permissions": {
          "code": "permitted",
          "haiku": "permitted_within_allowance",
          "sonnet": "escalation_with_reason",
          "opus": "approval_required"
        },
        "permissions_basis": "Programme routing rule (default).",
        "allowance_eur": {
          "per_task": null,
          "daily": null,
          "monthly": null,
          "period_time_zone": "Europe/Nicosia",
          "approved_by": null,
          "approved_at": null,
          "approval_reference": null
        },
        "approval_requirements": [
          "Paid or live execution requires an approved allowance.",
          "Opus requires the owner’s approval of a defined task and allowance."
        ],
        "source_limits": "Not shown in the public preview."
      }
    },
    {
      "name": "Production Controller TI",
      "code": "03AA-04_Production_Controller_TI",
      "interim_id": "ti-production-controller",
      "verification": "verified",
      "evidence": [
        "EV-TI-01",
        "EV-TI-04"
      ],
      "home": "03AA-04",
      "stream": "01",
      "repo_role": "Master Agent worker production_verification",
      "position": "Planned / configuration",
      "responsibilities": [
        "Detects delayed, missed, stalled and failed production runs",
        "Checks the published data.json is valid, fresh and complete",
        "Verifies GitHub Pages built the head of main and the site serves those files",
        "Keeps one deduplicated task per open exception; reports a verdict each run"
      ],
      "stages": {
        "built": "Yes: production checks and production_verification worker. Ordinary code; no model calls.",
        "tested": "Offline production tests in the repo; live read-only observation 21 Oct 2026 (repo record).",
        "merged": "On main.",
        "configured": "Mode observe (committed, the owner 21 Oct 2026): detects and reports, writes nothing. Automatic recovery disabled.",
        "operational": "Workflow scheduled hourly at :07 UTC and after the refresh and baseline build. Observe mode leaves no repository trace, so automatic runs cannot be confirmed without Actions run history. UNVERIFIED."
      },
      "integration": {
        "state": "none",
        "note": "Reporting is disabled and not connected. This public preview shows no live agent data."
      },
      "controls": {
        "model_permissions": {
          "code": "permitted",
          "haiku": "not_permitted",
          "sonnet": "not_permitted",
          "opus": "not_permitted"
        },
        "permissions_basis": "docs/TI_PRODUCTION_CONTROLLER.md: the agent is ordinary code and makes no model call and no spend. Any reported model use is a deviation.",
        "allowance_eur": {
          "per_task": null,
          "daily": null,
          "monthly": null,
          "period_time_zone": "Europe/Nicosia",
          "approved_by": null,
          "approved_at": null,
          "approval_reference": null
        },
        "approval_requirements": [
          "Paid or live execution requires an approved allowance.",
          "Opus requires the owner’s approval of a defined task and allowance."
        ],
        "source_limits": "Not shown in the public preview."
      }
    },
    {
      "name": "Agent SQE",
      "code": null,
      "interim_id": "sqe",
      "verification": "unverified",
      "evidence": [],
      "home": "03AA-01",
      "stream": "02",
      "position": "Development",
      "responsibilities": [
        "No accessible source."
      ],
      "stages": {
        "built": "Unverified",
        "tested": "Unverified",
        "merged": "Unverified",
        "configured": "Unverified",
        "operational": "Unverified"
      },
      "integration": {
        "state": "none",
        "note": "Reporting is disabled and not connected. This public preview shows no live agent data."
      },
      "controls": {
        "model_permissions": {
          "code": "permitted",
          "haiku": "permitted_within_allowance",
          "sonnet": "escalation_with_reason",
          "opus": "approval_required"
        },
        "permissions_basis": "Programme routing rule (default).",
        "allowance_eur": {
          "per_task": null,
          "daily": null,
          "monthly": null,
          "period_time_zone": "Europe/Nicosia",
          "approved_by": null,
          "approved_at": null,
          "approval_reference": null
        },
        "approval_requirements": [
          "Paid or live execution requires an approved allowance.",
          "Opus requires the owner’s approval of a defined task and allowance."
        ],
        "source_limits": "Not shown in the public preview."
      }
    },
    {
      "name": "Project Quality Agent (PQA)",
      "code": null,
      "interim_id": "pqa",
      "verification": "unverified",
      "evidence": [],
      "home": "03AA-02",
      "stream": "02",
      "position": "Development",
      "responsibilities": [
        "No accessible source."
      ],
      "stages": {
        "built": "Unverified",
        "tested": "Unverified",
        "merged": "Unverified",
        "configured": "Unverified",
        "operational": "Unverified"
      },
      "integration": {
        "state": "none",
        "note": "Reporting is disabled and not connected. This public preview shows no live agent data."
      },
      "controls": {
        "model_permissions": {
          "code": "permitted",
          "haiku": "permitted_within_allowance",
          "sonnet": "escalation_with_reason",
          "opus": "approval_required"
        },
        "permissions_basis": "Programme routing rule (default).",
        "allowance_eur": {
          "per_task": null,
          "daily": null,
          "monthly": null,
          "period_time_zone": "Europe/Nicosia",
          "approved_by": null,
          "approved_at": null,
          "approval_reference": null
        },
        "approval_requirements": [
          "Paid or live execution requires an approved allowance.",
          "Opus requires the owner’s approval of a defined task and allowance."
        ],
        "source_limits": "Not shown in the public preview."
      }
    },
    {
      "name": "Venture Engine Agent",
      "code": null,
      "interim_id": "venture-engine",
      "verification": "unverified",
      "evidence": [],
      "home": "03AA-03",
      "stream": "06",
      "position": "Proposed / status unverified",
      "responsibilities": [
        "No accessible source."
      ],
      "stages": {
        "built": "Unverified",
        "tested": "Unverified",
        "merged": "Unverified",
        "configured": "Unverified",
        "operational": "Unverified"
      },
      "integration": {
        "state": "none",
        "note": "Reporting is disabled and not connected. This public preview shows no live agent data."
      },
      "controls": {
        "model_permissions": {
          "code": "permitted",
          "haiku": "permitted_within_allowance",
          "sonnet": "escalation_with_reason",
          "opus": "approval_required"
        },
        "permissions_basis": "Programme routing rule (default).",
        "allowance_eur": {
          "per_task": null,
          "daily": null,
          "monthly": null,
          "period_time_zone": "Europe/Nicosia",
          "approved_by": null,
          "approved_at": null,
          "approval_reference": null
        },
        "approval_requirements": [
          "Paid or live execution requires an approved allowance.",
          "Opus requires the owner’s approval of a defined task and allowance."
        ],
        "source_limits": "Not shown in the public preview."
      }
    }
  ],
  "APPROVALS": [],
  "RECONCILIATION": [],
  "DEFAULT_MODEL_PERMISSIONS": {
    "code": "permitted",
    "haiku": "permitted_within_allowance",
    "sonnet": "escalation_with_reason",
    "opus": "approval_required"
  }
};
  if (typeof module !== 'undefined' && module.exports) module.exports = REGISTER_CONFIG;
  else root.ACC_REGISTER = REGISTER_CONFIG;
})(typeof window !== 'undefined' ? window : this);
