// Page templates for the Outcome shell. Zebric's Liquid pages render on the server and cannot include partials, so each
// page body is wrapped in the shared shell here, and `<!--action:...-->` markers are expanded into Zebric action forms.
import css from "../templates/shell.css";
import outcomes from "../templates/outcomes.liquid";
import outcome from "../templates/outcome.liquid";
import changes from "../templates/changes.liquid";
import activity from "../templates/activity.liquid";
import decisions from "../templates/decisions.liquid";

// Elapsed-time counters tick in the browser; everything else on the page is rendered by Zebric and refreshed by Live Mode.
const TICK = `<script>(function(){function f(s){s=Math.max(0,Math.round(s));if(s<90)return s+" s";var m=Math.round(s/60);return m<60?m+" min":Math.floor(m/60)+" h "+String(m%60).padStart(2,"0")+" min"}
function set(e,v){if(e.textContent!==v)e.textContent=v}
function tick(){document.querySelectorAll("[data-since]").forEach(function(e){var t=Date.parse(e.getAttribute("data-since"));if(t)set(e,f((Date.now()-t)/1000))});
document.querySelectorAll("[data-since-ms]").forEach(function(e){var t=Number(e.getAttribute("data-since-ms"));if(t)set(e,f((Date.now()-t)/1000))})}
tick();setInterval(tick,1000);new MutationObserver(tick).observe(document.body,{childList:true,subtree:true})})()</script>`;

/** Form that runs a Zebric workflow action against one record. Same shape Zebric's own action buttons post. */
function actionForm(workflow: string, entity: string, recordId: string, redirect: string, label: string, cls: string, payload: string): string {
	return `<form class="act" method="POST" action="/actions/${workflow}"><input type="hidden" name="_csrf" value="{{ csrfToken }}"><input type="hidden" name="entity" value="${entity}"><input type="hidden" name="recordId" value="${recordId}"><input type="hidden" name="redirect" value="${redirect}"><input type="hidden" name="payload" value='${payload}'><button class="${cls}" type="submit">${label}</button></form>`;
}

function expand(body: string): string {
	return body.replace(/<!--action:([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(.*?)-->/g, (_m, wf, entity, id, redirect, label, cls, payload) => actionForm(wf, entity, id, redirect, label, cls, payload));
}

/**
 * The hub shell: a lifecycle bar (Ideas, Decisions, Build, Launch, Operations), the current outcome and a breadcrumb,
 * all read from the page's own Zebric queries (nothing is stored or invented). Only Decisions and Build are real
 * destinations; the others are plain text marked as planned, never links. Zebric's own sidebar (brand, Build, Decisions,
 * Artifacts, Activity) comes from [ux.navigation] in the blueprint.
 */
type Section = "build" | "outcome" | "decisions" | "artifacts" | "activity";
const CRUMB: Record<Section, string> = {
	build: `<b>Build</b>`,
	outcome: `<a href="/">Build</a><i>/</i><b>{{ ho.title }}</b>`,
	decisions: `<b>Decisions</b>`,
	artifacts: `<a href="/">Build</a><i>/</i><b>Artifacts</b>`,
	activity: `<a href="/">Build</a><i>/</i><b>Activity</b>`,
};
function hub(section: Section): string {
	const buildOn = section !== "decisions";
	const future = `<span class="hs future" title="A planned capability of the hub, not part of this demo" aria-disabled="true"><i class="mk"></i>`;
	return `{% assign ho = data.outcome[0] %}{% unless ho %}{% for o in data.outcomes %}{% unless o.seeded %}{% unless ho %}{% assign ho = o %}{% endunless %}{% endunless %}{% endfor %}{% endunless %}{% if ho %}{% assign hp = ho | project: data %}{% endif %}
<div class="hub"><div class="hub-in">
<nav class="hub-life" aria-label="Idea to Operations lifecycle">
${future}Ideas</span>
<a class="hs${section === "decisions" ? " on" : ""}" href="/decisions"${section === "decisions" ? ' aria-current="page"' : ""}><i class="mk"></i>Decisions</a>
<a class="hs${buildOn ? " on" : ""}" href="/"${buildOn ? ' aria-current="page"' : ""}><i class="mk"></i>Build</a>
${future}Launch</span>
${future}Operations</span>
</nav>
<div class="hub-side">
{% if data.pending.size > 0 %}<a class="hub-dec" href="/decisions"><i class="dot pulse"></i>{{ data.pending.size }} decision{% if data.pending.size != 1 %}s{% endif %} waiting</a>{% endif %}
{% if hp %}<a class="hub-ctx" href="/outcomes/{{ ho.id }}"><b>{{ hp.title }}</b><span class="chip {{ hp.status }}">{% if hp.status == "building" %}<i class="dot pulse"></i>{% endif %}{{ hp.statusLabel }}</span></a>{% endif %}
</div>
</div></div>
<div class="crumb-row"><a href="/">Idea to Operations Hub</a><i>/</i>${CRUMB[section]}</div>`;
}

function page(body: string, section: Section): string {
	return `<style>${css}</style>${hub(section)}${expand(body)}${TICK}`;
}

export const TEMPLATES: Record<string, string> = {
	"templates/outcomes.liquid": page(outcomes, "build"),
	"templates/outcome.liquid": page(outcome, "outcome"),
	"templates/changes.liquid": page(changes, "artifacts"),
	"templates/activity.liquid": page(activity, "activity"),
	"templates/decisions.liquid": page(decisions, "decisions"),
};
