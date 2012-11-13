local Utils = require("Utils")
local Log = require("Log")
local Database = require("Database")
local SQL = Database.SQL
local Tokens = require("Tokens")
local G = require("G")

local nextoid = 0
local seenbydb = {}

local function get_property_type(class, name)
	while class do
		local p = class.properties
		if p then
			local t = p[name]
			if t then
				return t
			end
		end
		
		class = class.superclass
	end
end

local function create_eav_table(type, name)
	local tablename = "eav_"..name
	local keytype = "PRIMARY KEY"
	if type.isaggregate then
		keytype = "NOT NULL"
	end
	SQL(
		"CREATE TABLE IF NOT EXISTS "..tablename..
			" (oid INTEGER "..keytype.." REFERENCES eav_Class(oid), value "..type.sqltype..")"
	):step()
	
	if type.isaggregate then
		SQL(
			"CREATE INDEX IF NOT EXISTS index_byoid_"..tablename.." ON "..tablename.." (oid)"
			):step()
		SQL(
			"CREATE INDEX IF NOT EXISTS index_byboth_"..tablename.." ON "..tablename.." (oid, value)"
			):step()
	end
	
	return tablename
end

return
{
	Lookup = function (class, oid, name)
		local t = get_property_type(class, name)
		if not t then
			return t
		end
		
		local tablename = create_eav_table(t, name)

		local kid = Tokens[name]
		
		local propertyhash = oid .. "." .. name

		local function dirty()
			seenbydb[propertyhash] = {}
		end
		 
		local datum = 
		{
			type = t,
			oid = oid,
			name = name,
			kid = kid,
			
			IsSet = function()
				local isset = SQL(
					"SELECT COUNT(*) FROM "..tablename.." WHERE oid = ?"
					):bind(oid):step()
				
				return isset[1] ~= 0
			end,
			
			Get = function()
				return t.Get(tablename, oid, dirty)
			end,
			
			Set = function(value)
				t.Set(tablename, oid, value)
				dirty()
			end,
			
			Export = function()
				local f = t.Export or t.Get
				return f(tablename, oid)
			end,
			
			TestAndSetSyncBit = function()
				local s = seenbydb[propertyhash]
				if not s then
					s = {}
					seenbydb[propertyhash] = s
				end

				local needssync = (s[G.CurrentCookie] ~= true)
				s[G.CurrentCookie] = true
				return needssync				
			end 
		}
		
		return datum 
	end,
}
