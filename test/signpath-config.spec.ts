import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("SignPath product metadata restrictions", () => {
  it("requires one version parameter and constrains every signed PE file", () => {
    const xml = read(".signpath/artifact-configuration.xml");
    expect(xml).toContain('<parameter name="version" required="true" />');
    const peFiles = [...xml.matchAll(/<pe-file\s[^>]*>/g)].map(([element]) => element);
    expect(peFiles).toHaveLength(2);
    for (const element of peFiles) {
      expect(element).toContain('product-name="TikZ Editor"');
      expect(element).toContain('product-version="${version}"');
    }
    expect(xml).toContain('subject="TikZ Editor"');
    expect(xml).toContain('author="tikz"');
  });

  it("passes the validated build version to both signing requests, without hardcoding it", () => {
    const action = read(".github/actions/build-sign-windows/action.yml");
    expect(action).toContain('id: metadata');
    expect(action).toContain('$version = [string]$config.version');
    expect(action).toContain('$metadata.ProductName -cne $config.productName');
    expect(action).toContain('$metadata.ProductVersion -cne $version');
    expect(action).toContain('"version=$version" >> $env:GITHUB_OUTPUT');
    const requests = action.split(/ {4}- name: Sign (?:application executable|Windows installers)\n/).slice(1);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const step = request.split(/\n {4}- /)[0];
      expect(step).toContain('version: ${{ toJSON(steps.metadata.outputs.version) }}');
    }
    expect(action.indexOf('id: metadata')).toBeLessThan(action.indexOf('name: Sign application executable'));
  });
});
