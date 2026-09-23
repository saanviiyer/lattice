import { describe, expect, it } from "vitest";
import { parseBibTeX, parseBibliography, parseRis } from "../lib/bibliographyImport";

describe("bibliography import", () => {
  it("parses BibTeX records, nested braces, authors, and keywords", () => {
    const records = parseBibTeX(`@inproceedings{vaswani2017,
      title={Attention {Is} All You Need}, author={Vaswani, Ashish and Shazeer, Noam},
      year={2017}, booktitle={NeurIPS}, keywords={transformers, foundational}, url={https://example.test}
    }`);
    expect(records).toHaveLength(1);
    expect(records[0].metadata.itemType).toBe("conferencePaper");
    expect(records[0].metadata.authors).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
    expect(records[0].metadata.title).toBe("Attention Is All You Need");
    expect(records[0].tags).toEqual(["transformers", "foundational"]);
  });

  it("parses RIS records and detects the format", () => {
    const ris = `TY  - JOUR\nTI  - A Useful Paper\nAU  - Lovelace, Ada\nPY  - 2026/01/01\nJO  - Test Journal\nDO  - 10.1/test\nKW  - methods\nER  -`;
    const record = parseRis(ris)[0];
    expect(record.metadata.title).toBe("A Useful Paper");
    expect(record.metadata.authors).toEqual(["Ada Lovelace"]);
    expect(record.metadata.year).toBe(2026);
    expect(parseBibliography(ris, "library.txt")).toHaveLength(1);
  });
});
