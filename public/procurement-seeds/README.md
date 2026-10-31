# Synthetic seed and acceptance specification

These CSV files are preparation material. They are not executable product tests and no pass rate is claimed. Generate the invoice PDFs and automate assertions during implementation.

All identities are fictional. Use DEMOCO as the buyer entity and display a fictional buyer name such as Demo Company on invoices. The two prior Northstar obligations total USD 7,200 net and are the imported baseline for PO1042. Folio must not also create local reservations for them.

For the clean path, use Cedar Systems, a new invoice reference, PO1043 line L1, 10 hours at USD 100, explicit tax USD 0 and gross USD 1,000. The scan case uses another Cedar invoice reference, net USD 1,000, stated included tax USD 180 and gross USD 1,180. The tax values are arithmetic examples and make no jurisdictional tax claim. Reset to the documented baseline between independent scenario tests, or explicitly include the commitments created by earlier tests.

For the cumulative overrun, use Northstar invoice NS-0419, PO1042 line L1 and USD 3,100 net with explicit zero tax. This line is a blanket amount cap, so unit price tolerance is Not applicable. Capacity is the decisive check. PO1044 and PO1045 support the missing-reference ambiguity scenario.

The acceptance file contains 24 business document cases and six system scenarios. Initial outcomes assume all other checks pass. The implementation must evaluate additional issues and apply the PRD's severity precedence. Exact repeats of the same file should return or link the original case and never add another reservation.

Create separate fixture variants for goods requiring receipt confirmation, file limits, password protection, one-cent tolerance overflow, closed PO and source-location failures. They are useful supplemental checks beyond the 30-case release matrix. Keep holdout documents separate from development and label them before measuring results.
