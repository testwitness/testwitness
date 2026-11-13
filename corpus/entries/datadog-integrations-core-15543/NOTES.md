# DataDog/integrations-core#15543

Lowers the codecov project status target of the SNMP component from 50 to 30 in .codecov.yml. Weakened gate. The engine reads codecov project targets but reports nothing here (missed). Stresses C002 on a named codecov project status in a large config.
