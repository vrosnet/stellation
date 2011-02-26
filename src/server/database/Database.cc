#include "globals.h"
#include "Database.h"
#include "Datum.h"
#include "Property.h"
#include "Writer.h"
#include "Log.h"
#include "SObject.h"
#include "utils.h"
#include "okvstore.h"

static okvstore<Database::Type, Hash::Type, Datum> database;
static map<Database::Type, double> lastChanged;

Database::Type DatabaseAllocateOid()
{
	static unsigned int i = (int) Database::Universe;
	return (Database::Type) i++;
}

Datum& DatabaseGet(Database::Type oid, Hash::Type kid)
{
	Datum& datum = database.get(oid, kid);
	if (datum.GetOid() == Database::Null)
	{
		/* New, freshly-minted datum --- initialise it. */
		datum.SetOidKid(oid, kid);
	}
	return datum;
}

void DatabaseDirty(Database::Type oid, Hash::Type kid)
{
	lastChanged[oid] = CurrentTime();
	database.dirty(oid, kid);
}

void DatabaseCommit()
{
	int changed;
	database.diagnostics(changed);

//	Log() << "committing: "
//		  << changed << " changed values";
	database.commit();
}

void DatabaseRollback()
{
	int changed;
	database.diagnostics(changed);

	Log() << "rolling back: "
		  << changed << " changed values";
	database.rollback();

	SObject::FlushCache();
}

double DatabaseLastChangedTime(Database::Type oid)
{
	return lastChanged[oid];
}

class WriterVisitor
{
	public:
		WriterVisitor(Writer& writer):
			_writer(writer)
		{ }

		void operator () (Database::Type oid, Hash::Type kid, const Datum& datum)
		{
			_writer.Write(oid);
			_writer.Write(kid);

			switch (datum.GetType())
			{
				case Datum::NUMBER:
					_writer.Write(Hash::Number);
					_writer.Write((double)datum);
					break;

				case Datum::STRING:
				{
					_writer.Write(Hash::String);
					_writer.Write((string)datum);
					break;
				}

				case Datum::OBJECT:
				{
					_writer.Write(Hash::Object);
					_writer.Write(datum.GetObject());
					break;
				}

				case Datum::TOKEN:
				{
					_writer.Write(Hash::Token);
					_writer.Write((Hash::Type)datum);
					break;
				}

				case Datum::OBJECTSET:
				{
					_writer.Write(Hash::ObjectSet);
					_writer.Write(datum.SetLength());

					for (Datum::ObjectSet::const_iterator i = datum.SetBegin(),
							e = datum.SetEnd(); i != e; i++)
					{
						_writer.Write(*i);
					}

					break;
				}

				case Datum::OBJECTMAP:
				{
					_writer.Write(Hash::ObjectMap);
					_writer.Write(datum.MapLength());

					for (Datum::ObjectMap::const_iterator i = datum.MapBegin(),
							e = datum.MapEnd(); i != e; i++)
					{
						_writer.Write(i->first);
						_writer.Write(i->second);
					}

					break;
				}

				default:
					assert(false);
			}
		}

	private:
		Writer& _writer;
};

void DatabaseSave(Writer& writer)
{
	WriterVisitor visitor(writer);
	database.visit(visitor);
}
