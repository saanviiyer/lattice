// Naming a group after the field it belongs to.
//
// Clustering gives you the papers that go together and the words they share. It
// does not give you a name: the top terms of a cluster about safe reinforcement
// learning are "reward", "policy", "safe", which reads as a search query rather
// than as a subject. So a cluster's terms are matched against a vocabulary of
// actual research fields, and where the evidence is there, the field's own name
// is used — "Reinforcement learning", "AI safety", "Protein structure prediction".
//
// The vocabulary is deliberately a plain list rather than anything learned. It is
// readable, it is arguable, and adding a field your library needs is one line.
// Where nothing matches well enough, the group keeps a phrase drawn from its own
// content: a wrong name is worse than a plain one.

export interface Field {
  name: string;
  /**
   * Whether this is a way of doing research or a thing being researched.
   *
   * The distinction is what makes a concrete suggestion possible: "apply active
   * learning to antibody engineering" is a proposal, "combine antibodies and
   * protein stability" is a shrug.
   */
  kind: "method" | "domain";
  /** Terms that indicate this field. Stemmed the same way documents are. */
  terms: string[];
  /** Terms that must not be present — for fields that share vocabulary. */
  not?: string[];
}

// Ordered roughly narrow-to-broad. Where two fields match equally, the earlier —
// and therefore more specific — one wins, because "AI safety" is a more useful
// name for a collection than "Machine learning".
export const FIELDS: Field[] = [
  // ---- AI / ML ----
  { name: "AI safety", kind: "method", terms: ["safety", "safe", "alignment", "align", "harm", "misalign", "deceptive", "oversight", "corrigib", "existential", "catastroph"] },
  { name: "Interpretability", kind: "method", terms: ["interpret", "explain", "explanation", "saliency", "attribution", "probing", "mechanistic", "feature visualization", "circuit"] },
  { name: "Reinforcement learning", kind: "method", terms: ["reinforcement", "reward", "policy", "agent", "bandit", "q learning", "actor critic", "markov decision", "exploration"] },
  { name: "Language models", kind: "method", terms: ["language model", "llm", "transformer", "gpt", "bert", "pretrain", "token", "attention", "prompt", "instruction"] },
  { name: "Generative models", kind: "method", terms: ["generative", "diffusion", "gan", "vae", "autoencoder", "sampling", "score based", "flow", "denois"] },
  { name: "Graph neural networks", kind: "method", terms: ["graph neural", "graph convolution", "message passing", "gnn", "equivariant", "geometric deep"] },
  { name: "Computer vision", kind: "method", terms: ["image", "vision", "convolutional", "segmentation", "object detection", "visual"] },
  { name: "Representation learning", kind: "method", terms: ["representation", "embedding", "self supervised", "contrastive", "latent space", "encoder"] },
  { name: "Transfer learning", kind: "method", terms: ["transfer learning", "fine tun", "domain adaptation", "few shot", "zero shot", "distillation"] },
  { name: "Uncertainty and calibration", kind: "method", terms: ["uncertainty", "calibration", "bayesian", "posterior", "confidence", "gaussian process", "ensemble"] },
  { name: "Optimization methods", kind: "method", terms: ["optimization", "optimize", "gradient", "convergence", "objective", "descent", "regularization"] },
  { name: "Benchmarks and evaluation", kind: "method", terms: ["benchmark", "evaluation", "evaluate", "dataset", "leaderboard", "metric", "assessment", "comparison"] },
  { name: "Active learning and experiment design", kind: "method", terms: ["active learning", "experimental design", "acquisition", "batch selection", "adaptive sampling"] },

  // ---- Structural biology and protein science ----
  { name: "Protein structure prediction", kind: "domain", terms: ["structure prediction", "protein structure", "alphafold", "rosettafold", "fold", "contact map", "secondary structure", "tertiary", "backbone", "distance prediction"] },
  { name: "Protein design", kind: "domain", terms: ["protein design", "de novo", "design protein", "scaffold", "hallucination", "binder", "inverse folding"] },
  { name: "Protein engineering", kind: "domain", terms: ["protein engineering", "engineer", "engineering", "sequence space", "protein variant", "designing protein"] },
  { name: "Directed evolution", kind: "domain", terms: ["directed evolution", "mutagenesis", "variant library", "screening", "fitness landscape", "epistasis"] },
  { name: "Protein language models", kind: "domain", terms: ["protein language", "sequence model", "esm", "protein embedding", "masked language"] },
  { name: "Protein stability", kind: "domain", terms: ["stability", "thermostability", "ddg", "melting", "folding stability", "destabiliz"] },
  { name: "Enzyme engineering", kind: "domain", terms: ["enzyme", "catalysis", "catalytic", "substrate", "kcat", "turnover", "biocatalysis"] },
  { name: "Antibody engineering", kind: "domain", terms: ["antibody", "antibodies", "epitope", "paratope", "immunoglobulin", "nanobody", "humaniz"] },
  { name: "Molecular docking and binding", kind: "domain", terms: ["docking", "binding affinity", "ligand", "pocket", "protein protein interaction", "complex prediction"] },
  { name: "Drug discovery", kind: "domain", terms: ["drug", "compound", "small molecule", "pharmacophore", "admet", "lead optimization", "protac"] },
  { name: "Variant effect prediction", kind: "domain", terms: ["variant effect", "mutation effect", "missense", "pathogenic", "deep mutational", "clinical variant"] },
  { name: "Function annotation", kind: "domain", terms: ["annotation", "function prediction", "gene ontology", "classification", "homology", "alignment", "family"] },
  { name: "Molecular dynamics", kind: "method", terms: ["molecular dynamics", "simulation", "conformation", "free energy", "coarse grain", "trajectory"] },
  { name: "Cryo-EM and imaging", kind: "domain", terms: ["cryo em", "microscopy", "tomography", "reconstruction", "density map"] },
  { name: "Immunology and T cells", kind: "domain", terms: ["mhc", "t cell", "receptor repertoire", "immune", "peptide binding", "neoantigen"] },
  { name: "Genomics", kind: "domain", terms: ["genome", "transcription", "rna", "dna binding", "regulatory", "single cell", "expression"] },
  { name: "Neuroscience", kind: "domain", terms: ["neuron", "neural coding", "hippocamp", "cortex", "spike", "replay", "brain"] },
  { name: "Protein solubility and expression", kind: "domain", terms: ["solubility", "soluble", "expression", "crystalliz", "aggregation", "yield"] },
  { name: "Subcellular localization", kind: "domain", terms: ["localization", "localisation", "subcellular", "membrane protein", "signal peptide", "transmembrane"] },
  { name: "Sequence alignment", kind: "method", terms: ["alignment", "msa", "multiple sequence", "homolog", "profile", "phylogen"] },
  { name: "Post-translational modification", kind: "domain", terms: ["phosphorylation", "ubiquitination", "glycosylation", "acetylation", "modification site"] },
  { name: "Peptide design", kind: "domain", terms: ["peptide", "antimicrobial", "cell penetrating", "cyclic"] },
  { name: "Protein function prediction", kind: "domain", terms: ["function prediction", "protein function", "functional site", "active site", "catalytic site", "ec number"] },
];

/**
 * The field a group belongs to, given its terms weighted by importance.
 *
 * Returns null when no field is supported well enough by the evidence — an
 * unnamed group is honest, a mislabelled one is not.
 */
export function matchField(
  weights: Array<[string, number]>,
  minimumScore = 0.09
): { name: string; score: number } | null {
  if (weights.length === 0) return null;
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0) || 1;

  let best: { name: string; score: number } | null = null;
  for (const field of FIELDS) {
    let score = 0;
    let hits = 0;
    let excluded = false;
    for (const [term, weight] of weights) {
      if (field.not?.some((bad) => term.includes(bad))) excluded = true;
      // The field's term has to be present in the document's term, not the other
      // way round. Matching in both directions lets the bare word "design" match
      // the field term "experimental design", which put every protein-design
      // paper under "Active learning and experiment design".
      if (field.terms.some((candidate) => term === candidate || term.includes(candidate))) {
        score += weight;
        hits += 1;
      }
    }
    if (excluded) continue;
    const normalized = score / total;
    // One matching term is usually a coincidence — a single title mentioning
    // "reward" should not name nine papers "Reinforcement learning". Two terms is
    // a pattern; so is one term that dominates the group's whole vocabulary, which
    // is what "structure prediction" does to a cluster of structure-prediction
    // papers.
    if (hits < 2 && normalized < 0.2) continue;
    // Strictly greater, so the earlier (more specific) field wins a tie.
    if (normalized >= minimumScore && (!best || normalized > best.score)) {
      best = { name: field.name, score: normalized };
    }
  }
  return best;
}
