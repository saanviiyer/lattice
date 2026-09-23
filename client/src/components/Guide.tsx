// The in-app guide: how a researcher is meant to use lattice, with the knowledge
// graph treated as the main instrument rather than a decoration.

import type { ReactNode } from "react";
import {
  IconArrowRight,
  IconCompass,
  IconGraph,
  IconNote,
  IconQuestion,
  IconSparkle,
  IconLibrary,
} from "./Icons";

interface Props {
  hasSample: boolean;
  onLoadSample: () => void;
  onRemoveSample: () => void;
  onOpenGraph: () => void;
  onAddPaper: () => void;
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 text-[11px] text-slate-400">
        {n}
      </div>
      <div className="min-w-0">
        <h4 className="font-medium text-slate-200">{title}</h4>
        <div className="mt-1 space-y-1.5 text-sm leading-relaxed text-slate-400">
          {children}
        </div>
      </div>
    </div>
  );
}

function Legend({ color, name, meaning }: { color: string; name: string; meaning: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className="text-sm text-slate-400">
        <span className="text-slate-200">{name}</span> {meaning}
      </span>
    </li>
  );
}

function Gesture({ keys, does }: { keys: string; does: string }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <code className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-300">
        {keys}
      </code>
      <span className="text-sm text-slate-400">{does}</span>
    </div>
  );
}

export default function Guide({
  hasSample,
  onLoadSample,
  onRemoveSample,
  onOpenGraph,
  onAddPaper,
}: Props) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-10">
        <header>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Guide</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-100">
            How to work in lattice
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            lattice is built around one loop: collect a paper, read it with a pen in your
            hand, capture the one thing worth keeping, connect it to what you already
            think, then ask the library what it now says. The knowledge graph is where
            that last part becomes visible.
          </p>
        </header>

        <section className="lat-panel p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-slate-200">
                {hasSample ? "Sample workspace loaded" : "Try it on a sample workspace"}
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                {hasSample
                  ? "The sample records are tagged sample and can be removed cleanly at any time."
                  : "Nine illustrative papers, four notes, and two research questions, shaped so every part of the graph below has something to show. These are placeholder records, not real citations."}
              </p>
            </div>
            {hasSample ? (
              <div className="flex gap-2">
                <button onClick={onOpenGraph} className="lat-chip">
                  Open the graph
                </button>
                <button onClick={onRemoveSample} className="lat-chip">
                  Remove sample
                </button>
              </div>
            ) : (
              <button
                onClick={onLoadSample}
                className="shrink-0 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
              >
                Load sample workspace
              </button>
            )}
          </div>
        </section>

        <section className="space-y-5">
          <h2 className="flex items-center gap-2 text-lg font-medium text-slate-100">
            <IconCompass width={18} /> The loop
          </h2>

          <Step n={1} title="Collect, without deciding yet">
            <p>
              Add papers by DOI, arXiv id, or PDF upload, or import a whole .bib or .ris
              file. Save the web clipper for anything that is not a paper. Do not file
              things carefully at this stage; the Unfiled and Needs metadata smart views
              will find them again later.
            </p>
            <p className="mt-2">
              A paper added by DOI or arXiv id goes looking for its own PDF, so an
              open-access paper is ready to annotate the moment it lands. When it is
              behind a paywall, the paper view says so and waits for your own copy.
            </p>
          </Step>

          <Step n={2} title="Read with a pen in your hand">
            <p>
              Open the PDF and highlight as you go, in five colours. Pick a convention and
              keep it: one colour for claims you might cite, one for methods you would
              have to reproduce, one for things you disagree with. Attach a note to a
              highlight the moment you have a reaction, because you will not have it
              again on a second pass.
            </p>
          </Step>

          <Step n={3} title="Capture one takeaway per paper">
            <p>
              Each paper has a single takeaway field. One or two sentences, written for
              the version of you who has forgotten this paper. If you cannot write one,
              you have not finished reading. Takeaways are what the library Q and A
              searches over, so a library of empty takeaways answers nothing.
            </p>
          </Step>

          <Step n={4} title="Connect it to what you already think">
            <p>
              Write notes, not summaries. A note earns its place when it puts two papers
              in the same sentence. Link with <code className="lat-code">[[double brackets]]</code>{" "}
              and the autocomplete will suggest papers, notes, and research questions by
              title.
            </p>
            <p>
              The editor takes Markdown as you type: <code className="lat-code">- </code>{" "}
              starts a bullet, <code className="lat-code">1. </code> a numbered item,{" "}
              <code className="lat-code">[] </code> a to-do, <code className="lat-code">#</code>{" "}
              a heading. <code className="lat-code">Tab</code> nests a list item and{" "}
              <code className="lat-code">Shift+Tab</code> lifts it back out;{" "}
              <code className="lat-code">/</code> opens the full block menu.
            </p>
            <p>
              Turn durable uncertainties into research questions and link the papers that
              bear on them. A question with evidence attached is a thread you are actually
              pulling; a question with none is one you have only worried about.
            </p>
          </Step>

          <Step n={5} title="Ask the library, then check its work">
            <p>
              The Research desk answers questions across your saved abstracts and
              takeaways and cites which records it used. Without an API key it returns a
              ranked evidence map rather than inventing prose. Either way, treat the
              sources as the output and the sentences as a draft.
            </p>
          </Step>
        </section>

        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-medium text-slate-100">
            <IconLibrary width={18} /> How to structure a project
          </h2>
          <p className="text-sm leading-6 text-slate-400">
            A project holds the papers, the notes, and the open questions for one line of
            inquiry. It is the page you open when you want to think about an idea rather
            than file one. Four rules keep projects useful as the library grows.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                rule: "A project is a claim, not a topic",
                body: "If you cannot state it so that it could turn out to be wrong, it is a topic — and topics belong in tags. “Hippocampal replay” is a tag. “Replay causes consolidation rather than accompanying it” is a project. The premise field at the top of every project is there to force this.",
              },
              {
                rule: "Start it from a hunch, not from a shelf",
                body: "Make the project the moment you have the question, before you have the reading. A project with one question and no papers is a real project. A project with forty papers and no question is a reading list wearing a costume. Double-click any paper or note to file it — the dialog will create the project for you if it does not exist yet.",
              },
              {
                rule: "Subprojects are parts of the argument",
                body: "Split only when you can name the parts: the falsifier experiment, the control reviewers will ask for, chapter two. Not subtopics — those are tags again. Selecting a parent shows everything beneath it, so nesting costs you nothing in visibility.",
              },
              {
                rule: "Tags cut across, projects contain",
                body: "A method you use in three projects is a tag. A paper can sit in several projects when it genuinely bears on several. Use the smart views for state — to read, unfiled, needs metadata — and leave projects for what a thing is about.",
              },
            ].map((item) => (
              <div key={item.rule} className="lat-panel p-4">
                <p className="text-sm font-medium text-slate-100">{item.rule}</p>
                <p className="mt-1.5 text-xs leading-5 text-slate-500">{item.body}</p>
              </div>
            ))}
          </div>

          <div className="lat-panel p-4">
            <p className="text-sm font-medium text-slate-100">What the project page is for</p>
            <p className="mt-1.5 text-sm leading-6 text-slate-400">
              Every project page ends with <span className="text-slate-200">what this needs</span>:
              a question with no evidence attached, a paper opened but never summarised, a note that
              links to nothing, a paper nothing in the project refers to. A shelf of papers looks
              like progress. That list is the honest version — and when it is empty, the project is
              ready to write.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-medium text-slate-100">
            <IconGraph width={18} /> Reading the knowledge graph
          </h2>
          <p className="text-sm leading-relaxed text-slate-400">
            The graph is not a picture of your library. It is a picture of the
            connections you have actually made, which is a different and much smaller
            thing. That gap is the point: what is missing from the graph is the work you
            have not done yet.
          </p>

          <div className="lat-panel p-4">
            <h3 className="text-sm font-medium text-slate-200">What you are looking at</h3>
            <ul className="mt-3 space-y-2">
              <Legend
                color="#818cf8"
                name="Indigo circles are papers."
                meaning="Bigger means more connected."
              />
              <Legend
                color="#34d399"
                name="Green circles are notes."
                meaning="These are usually your hubs, because notes are where linking happens."
              />
              <Legend
                color="#fbbf24"
                name="Amber rings are research questions."
                meaning="Their links point at the evidence you have gathered for them."
              />
            </ul>
            <p className="mt-3 text-sm text-slate-400">
              Line colour tells you why two things are connected: grey for a{" "}
              <code className="lat-code">[[wikilink]]</code> you wrote, indigo for a paper
              joined to its own notes doc, cyan for papers you marked related, amber for a
              question joined to its evidence. Turn any of them off in the sidebar to see
              what the graph looks like without that kind of connection.
            </p>
          </div>

          <div className="lat-panel p-4">
            <h3 className="text-sm font-medium text-slate-200">Gestures</h3>
            <div className="mt-2 divide-y divide-slate-800/60">
              <Gesture keys="click" does="Focus a node. Everything more than one hop away dims, so you see its immediate world." />
              <Gesture keys="1 hop / 2 hops" does="Widen the focus to include the neighbours of the neighbours." />
              <Gesture keys="shift-click" does="Trace the shortest path from the focused node to this one, and count the hops." />
              <Gesture keys="double-click" does="Open the paper, note, or question." />
              <Gesture keys="drag a node" does="Pull it out of the tangle. Drag the background to pan, scroll to zoom." />
              <Gesture keys="esc" does="Clear the focus and light everything back up." />
            </div>
          </div>

          <div className="lat-panel p-4">
            <h3 className="text-sm font-medium text-slate-200">
              Four questions worth asking it
            </h3>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-400">
              <p>
                <span className="text-slate-200">What is my thinking resting on?</span> The
                Load bearing list ranks nodes by how many things connect to them. If a
                single note is holding your whole argument together, that note is worth
                rereading, and probably worth splitting.
              </p>
              <p>
                <span className="text-slate-200">What have I saved and never used?</span>{" "}
                The Not yet connected list is every paper and note linked to nothing at
                all. A long list is not a failure, it is a reading queue with a reason
                attached. Clear it by writing the note that mentions the paper.
              </p>
              <p>
                <span className="text-slate-200">Is this one body of work or several?</span>{" "}
                Separate islands counts the disconnected clusters. Two islands usually
                means two projects, which is fine. Two islands inside one project means
                you have not yet found the paper that joins them.
              </p>
              <p>
                <span className="text-slate-200">
                  How are these two things related, if at all?
                </span>{" "}
                Focus one node, shift-click another, and read the chain in the sidebar. A
                three hop path through an unrelated note is a hint that the connection you
                assumed exists is one you have not actually made. No route at all is a
                stronger hint.
              </p>
            </div>
          </div>

          <div className="lat-panel p-4">
            <h3 className="text-sm font-medium text-slate-200">A weekly graph review</h3>
            <p className="mt-1 text-sm text-slate-400">
              Fifteen minutes, once a week, is enough to keep the graph honest:
            </p>
            <ol className="mt-3 space-y-2 text-sm text-slate-400">
              <li className="flex gap-2">
                <span className="text-slate-600">1.</span>
                <span>
                  Open the graph and check Questions with no evidence. Either attach a
                  paper to each one or admit it is not a live question and delete it.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-slate-600">2.</span>
                <span>
                  Take the top three from Not yet connected. For each, write one sentence
                  in an existing note that links it. Three sentences, three new edges.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-slate-600">3.</span>
                <span>
                  Look at the largest hub. If it has more than about a dozen links it has
                  stopped being a thought and become a folder. Split it.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-slate-600">4.</span>
                <span>
                  Hide notes for a moment, leaving only papers and questions. What is left
                  is your evidence base with your interpretation stripped out, which is
                  roughly what a reader of your paper will see.
                </span>
              </li>
            </ol>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-medium text-slate-100">
            <IconNote width={18} /> Keeping links resolvable
          </h2>
          <p className="text-sm leading-relaxed text-slate-400">
            A <code className="lat-code">[[wikilink]]</code> matches on title, so titles are
            the addressing scheme. Three habits keep the graph from quietly losing edges:
          </p>
          <ul className="space-y-2 text-sm leading-relaxed text-slate-400">
            <li>
              Give notes titles you would actually type. "Replay versus consolidation"
              gets linked; "Notes 3" does not.
            </li>
            <li>
              Fix an imported title before you link it. Renaming a paper later does not
              rewrite the links that pointed at the old title, and they will fall silently
              out of the graph.
            </li>
            <li>
              Use the autocomplete rather than typing the title from memory. It only
              suggests things that exist, so it cannot produce a dead link.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-medium text-slate-100">
            <IconQuestion width={18} /> Where things live
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { icon: <IconCompass width={14} />, name: "Research desk", what: "What to read next, and the library Q and A." },
              { icon: <IconLibrary width={14} />, name: "All papers", what: "The full library, with field filters like author: tag: year: status: color:." },
              { icon: <IconLibrary width={14} />, name: "Projects", what: "One page per line of inquiry: its premise, questions, papers, notes, and what it still needs." },
              { icon: <IconGraph width={14} />, name: "Graph", what: "Connections, hubs, orphans, and islands." },
              { icon: <IconNote width={14} />, name: "Notes", what: "Standalone notes plus one notes doc per paper." },
              { icon: <IconSparkle width={14} />, name: "Web clippings", what: "Anything the Chrome extension saved, waiting to be filed." },
              { icon: <IconArrowRight width={14} />, name: "Backup", what: "One .lattice file holding everything, PDFs included." },
            ].map((row) => (
              <div key={row.name} className="lat-panel flex items-start gap-2.5 p-3">
                <span className="mt-0.5 text-slate-500">{row.icon}</span>
                <div>
                  <p className="text-sm text-slate-200">{row.name}</p>
                  <p className="text-xs text-slate-500">{row.what}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="lat-panel flex flex-wrap items-center gap-3 p-4">
          <p className="min-w-0 flex-1 text-sm text-slate-400">
            Ready to start on your own library?
          </p>
          <button onClick={onAddPaper} className="lat-chip">
            Add a paper
          </button>
          <button onClick={onOpenGraph} className="lat-chip">
            Open the graph
          </button>
        </section>
      </div>
    </div>
  );
}
