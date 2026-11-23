local G = loadstring("return getgenv()")()
local out = {}
local pg = game:GetService("Players").LocalPlayer:FindFirstChild("PlayerGui")
if not pg then return {"NO PLAYERGUI"} end
local uv = pg:FindFirstChild("UnitView")
if not uv then return {"NO UNITVIEW"} end
local function walk(o, depth)
  if depth > 14 then return end
  local ok, cls = pcall(function() return o.ClassName end)
  if ok and cls == "TextLabel" then
    local ok2, txt = pcall(function() return o.Text end)
    if ok2 and txt and txt ~= "" then out[#out+1] = tostring(txt) end
  end
  local ok3, ch = pcall(function() return o:GetChildren() end)
  if ok3 then for _, c in ipairs(ch) do walk(c, depth+1) end end
end
walk(uv, 0)
return out
