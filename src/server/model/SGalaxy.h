#ifndef SGALAXY_H
#define SGALAXY_H

#include "SObject.h"

class SGalaxy : public SObject, public SGalaxyProperties
{
	CLASSLINK(SGalaxy)

public:
	SGalaxy(Database::Type oid);

	virtual void OnAdditionOf(SObject* o);
	virtual void OnRemovalOf(SObject* o);
};

#endif
