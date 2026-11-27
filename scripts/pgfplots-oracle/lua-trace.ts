/**
 * LuaTeX page walk for PGF text boxes.
 *
 * PGF inserts every node text box through the driver macro `\pgfsys@hbox`
 * (pgf-src/generic/pgf/systemlayer/pgfsys.code.tex). The instrumentation tags
 * the box register passed to that macro with a LuaTeX attribute; attributes
 * do not take part in layout. At shipout this walk follows the box tree and
 * the PDF transform stack (q/Q/cm in origin-mode literals) and writes one
 * TEXTBOX record per tagged box, in scaled points, page-local, y down.
 *
 * LuaTeX cannot read back the payload of token-backed pdf_literal nodes, so
 * the instrumentation also redefines `\pgfsys@invoke` to create a
 * string-backed origin-mode literal with the identical payload (the same
 * technique as scripts/lib/beamer-frame-oracle.mjs). The disturbance check
 * (`capture-pgfplots-oracles.mts --check-disturbance`) verifies that the PDF
 * painting is unchanged by this.
 */
export function pgfplotsOracleLuaSource(): string {
  return String.raw`pgfplotsoracle = pgfplotsoracle or {}
local M = pgfplotsoracle
local out = assert(io.open(tex.jobname .. "-textbox.tsv", "w"))
local attribute = luatexbase.new_attribute("pgfplotsoracle_textbox")
local counter = 0
M.enabled = false

function M.tagbox(register)
  if not M.enabled then return end
  local box = tex.getbox(register)
  if box then
    counter = counter + 1
    node.set_attribute(box, attribute, counter)
  end
end

function M.literal(data)
  local literal = node.new("whatsit", "pdf_literal")
  literal.mode, literal.data = 0, data
  node.write(literal)
end

local glyph_id, glue_id, kern_id = node.id("glyph"), node.id("glue"), node.id("kern")
local hlist_id, vlist_id, rule_id = node.id("hlist"), node.id("vlist"), node.id("rule")
local disc_id, whatsit_id, math_id = node.id("disc"), node.id("whatsit"), node.id("math")
local pdf_save, pdf_restore = node.subtype("pdf_save"), node.subtype("pdf_restore")
local pdf_setmatrix, pdf_literal = node.subtype("pdf_setmatrix"), node.subtype("pdf_literal")
local page_index = 0
local transform, stack = {1, 0, 0, 1, 0, 0}, {}
local unreadable_literals = 0

local function painted(x, y)
  local t = transform
  return t[1] * x + t[3] * y + t[5], t[2] * x + t[4] * y + t[6]
end

-- PDF matrices are y-up; the walk is y-down. An origin-mode literal is
-- anchored at the current TeX position (x, y).
local function concat(a, b, c, d, e, f, x, y)
  b, c, f = -b, -c, -f
  local oe, of = x - a * x - c * y + e, y - b * x - d * y + f
  local t = transform
  transform = {t[1] * a + t[3] * b, t[2] * a + t[4] * b, t[1] * c + t[3] * d, t[2] * c + t[4] * d,
    t[1] * oe + t[3] * of + t[5], t[2] * oe + t[4] * of + t[6]}
end

local function apply_literal(value, x, y)
  if value.mode ~= nil and value.mode ~= 0 then return end
  local data = value.data
  if type(data) ~= "string" then unreadable_literals = unreadable_literals + 1 return end
  local operands = {}
  for token in data:gmatch("%S+") do
    local number = tonumber(token)
    if number then
      operands[#operands + 1] = number
    else
      if token == "q" then
        stack[#stack + 1] = transform
      elseif token == "Q" then
        transform = table.remove(stack) or {1, 0, 0, 1, 0, 0}
      elseif token == "cm" and #operands == 6 then
        local bp = 65536 * 72.27 / 72
        concat(operands[1], operands[2], operands[3], operands[4], operands[5] * bp, operands[6] * bp, x, y)
      end
      operands = {}
    end
  end
end

local function apply_whatsit(value, x, y)
  if value.subtype == pdf_save then
    stack[#stack + 1] = transform
  elseif value.subtype == pdf_restore then
    transform = table.remove(stack) or {1, 0, 0, 1, 0, 0}
  elseif value.subtype == pdf_setmatrix then
    local k = {}
    for number in tostring(value.data):gmatch("[%+%-]?[%d%.]+") do k[#k + 1] = tonumber(number) end
    if #k == 4 then concat(k[1], k[2], k[3], k[4], 0, 0, x, y) end
  elseif value.subtype == pdf_literal then
    apply_literal(value, x, y)
  end
end

local function font_name(id)
  local data = font.getfont(id)
  if not data then return "" end
  return tostring(data.psname or data.fullname or data.name or ""):gsub("[\t\r\n|]", " ")
end

local function glue_width(value, parent)
  local width = value.width or 0
  if not parent then return width end
  local sign, order, set = parent.glue_sign or 0, parent.glue_order or 0, parent.glue_set or 0
  if sign == 1 and order == (value.stretch_order or 0) then
    width = width + set * (value.stretch or 0)
  elseif sign == 2 and order == (value.shrink_order or 0) then
    width = width - set * (value.shrink or 0)
  end
  return math.floor(width + 0.5)
end

local function collect_glyphs(list, into)
  if not list then return end
  for value in node.traverse(list) do
    if value.id == glyph_id then
      into[#into + 1] = tostring(value.char) .. "@" .. font_name(value.font)
    elseif (value.id == hlist_id or value.id == vlist_id) and not node.has_attribute(value, attribute) then
      collect_glyphs(value.list, into)
    elseif value.id == disc_id then
      collect_glyphs(value.replace, into)
    end
  end
end

local nesting = 0
local function write_textbox(value, x, top, baseline)
  local tag = node.has_attribute(value, attribute)
  local ox, oy = painted(x, baseline)
  local glyphs = {}
  collect_glyphs(value.list, glyphs)
  out:write(table.concat({"TEXTBOX", page_index, tag, nesting,
    math.floor(ox + 0.5), math.floor(oy + 0.5),
    transform[1], transform[2], transform[3], transform[4],
    value.width or 0, value.height or 0, value.depth or 0,
    table.concat(glyphs, " ")}, "\t"), "\n")
end

local walk_h, walk_v

walk_h = function(list, parent, x0, baseline)
  local x = x0
  if not list then return end
  for value in node.traverse(list) do
    local id = value.id
    if id == glyph_id then
      x = x + (value.width or 0)
    elseif id == glue_id then
      x = x + glue_width(value, parent)
    elseif id == kern_id then
      x = x + (value.kern or 0)
    elseif id == math_id then
      x = x + (value.surround or 0)
    elseif id == hlist_id or id == vlist_id then
      local child_baseline = baseline + (value.shift or 0)
      local top = child_baseline - (value.height or 0)
      local tagged = node.has_attribute(value, attribute) and id == hlist_id
      if tagged then write_textbox(value, x, top, child_baseline) nesting = nesting + 1 end
      if id == hlist_id then walk_h(value.list, value, x, child_baseline) else walk_v(value.list, value, x, top) end
      if tagged then nesting = nesting - 1 end
      x = x + (value.width or 0)
    elseif id == rule_id then
      x = x + (value.width or 0)
    elseif id == disc_id then
      walk_h(value.replace, parent, x, baseline)
      for r in node.traverse(value.replace) do if r.id == glyph_id then x = x + (r.width or 0) end end
    elseif id == whatsit_id then
      apply_whatsit(value, x, baseline)
    end
  end
end

walk_v = function(list, parent, x0, y0)
  local y = y0
  if not list then return end
  for value in node.traverse(list) do
    local id = value.id
    if id == glue_id then
      y = y + glue_width(value, parent)
    elseif id == kern_id then
      y = y + (value.kern or 0)
    elseif id == hlist_id or id == vlist_id then
      local x = x0 + (value.shift or 0)
      local baseline = y + (value.height or 0)
      local tagged = node.has_attribute(value, attribute) and id == hlist_id
      if tagged then write_textbox(value, x, y, baseline) nesting = nesting + 1 end
      if id == hlist_id then walk_h(value.list, value, x, baseline) else walk_v(value.list, value, x, y) end
      if tagged then nesting = nesting - 1 end
      y = y + (value.height or 0) + (value.depth or 0)
    elseif id == rule_id then
      y = y + (value.height or 0) + (value.depth or 0)
    elseif id == whatsit_id then
      apply_whatsit(value, x0, y)
    end
  end
end

luatexbase.add_to_callback("pre_shipout_filter", function(page)
  page_index = page_index + 1
  transform, stack, unreadable_literals, nesting = {1, 0, 0, 1, 0, 0}, {}, 0, 0
  out:write(table.concat({"PAGE", page_index, page.width or 0, page.height or 0, page.depth or 0}, "\t"), "\n")
  if page.id == vlist_id then walk_v(page.list, page, 0, 0) else walk_h(page.list, page, 0, page.height or 0) end
  out:write(table.concat({"ENDPAGE", page_index, unreadable_literals, #stack}, "\t"), "\n")
  out:flush()
  return true
end, "pgfplotsoracle.textbox-trace")
`;
}
