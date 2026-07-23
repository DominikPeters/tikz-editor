export function mountRenderedScene(group: SVGGElement, innerSvg: string): void {
  group.innerHTML = innerSvg;
  replaceTexSvgsWithImages(group);
}

export function wrapRenderedElements(elements: Element[], className?: string): SVGGElement | null {
  const [first] = elements;
  if (!first?.parentNode) {
    return null;
  }

  const namespace = first.namespaceURI ?? "http://www.w3.org/2000/svg";
  const wrapper = document.createElementNS(namespace, "g") as SVGGElement;
  if (className) {
    wrapper.setAttribute("class", className);
  }

  first.parentNode.insertBefore(wrapper, first);
  elements.forEach((element) => {
    wrapper.appendChild(element);
  });
  return wrapper;
}

function replaceTexSvgsWithImages(root: ParentNode): void {
  const labels = Array.from(root.querySelectorAll<SVGSVGElement>('svg[data-text-renderer="tex"]'));
  labels.forEach((label) => {
    const parent = label.parentNode;
    if (!parent) {
      return;
    }

    const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
    copyImagePresentationAttributes(label, image);
    image.setAttribute("href", texSvgDataUrl(label));
    parent.replaceChild(image, label);
  });
}

function copyImagePresentationAttributes(source: SVGSVGElement, target: SVGImageElement): void {
  ["x", "y", "width", "height", "opacity", "overflow", "color"].forEach((name) => {
    const value = source.getAttribute(name);
    if (value !== null) {
      target.setAttribute(name, value);
    }
  });

  Array.from(source.attributes).forEach((attribute) => {
    if (attribute.name.startsWith("data-")) {
      target.setAttribute(attribute.name, attribute.value);
    }
  });
}

function texSvgDataUrl(source: SVGSVGElement): string {
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("x");
  clone.removeAttribute("y");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clone.outerHTML)}`;
}
