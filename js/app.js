define([
	'jquery',
	'knockout',
	'components/webapi-configuration',
	'bootstrap',
	'facets'
], function ($, ko) {
	var appModel = function () {
		var self = this;
		$.support.cors = true;
		$('#querytext').focus();

		self.appInitializationFailed = ko.observable(false);
		self.initPromises = [];
		self.initComplete = function () {
			self.currentView('search');
			self.router.init();
		}

		self.loadingRelated = ko.observable(false);
		self.loadingEvidence = ko.observable(false);
		self.loadingReport = ko.observable(false);
		self.loadingReportDrilldown = ko.observable(false);

		self.activeReportDrilldown = ko.observable(false);

		self.cohortAnalyses = ko.observableArray();
		self.currentReport = ko.observable();
		self.reports = ko.observableArray([
			'Person',
			'Cohort Specific',
			'Condition Eras',
			'Conditions by Index',
			'Drugs by Index',
			'Procedures by Index',
			'Observation Periods',
			'Condition',
			'Drug Eras',
			'Drug Exposure',
			'Procedure',
			'Death'
			//'Measurement'
		]);

		self.loadCohortDefinition = function (cohortDefinitionId) {
			self.currentView('loading');

			var definitionPromise = $.ajax({
				url: self.services()[0].url + 'cohortdefinition/' + cohortDefinitionId,
				method: 'GET',
				contentType: 'application/json',
				success: function (cohortDefinition) {
					self.currentCohortDefinition(cohortDefinition);
				}
			});

			var infoPromise = $.ajax({
				url: self.services()[0].url + 'cohortdefinition/' + cohortDefinitionId + '/info',
				method: 'GET',
				contentType: 'application/json',
				success: function (generationInfo) {
					self.currentCohortDefinitionInfo(generationInfo);
				}
			});

			$.when(infoPromise, definitionPromise).done(function (ip, dp) {
				// now that we have required information lets compile them into data objects for our view
				var cdmSources = self.services()[0].sources.filter(hasCDM);
				var results = [];

				for (var s = 0; s < cdmSources.length; s++) {
					var source = cdmSources[s];

					self.sourceAnalysesStatus[source.sourceKey] = ko.observable({
						ready: false,
						checking: false
					});

					var sourceInfo = getSourceInfo(source);
					var cdsi = {};
					cdsi.name = cdmSources[s].sourceName;

					if (sourceInfo != null) {
						cdsi.isValid = sourceInfo.isValid;
						cdsi.status = sourceInfo.status;
						var date = new Date(sourceInfo.startTime);
						cdsi.startTime = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
						cdsi.executionDuration = (sourceInfo.executionDuration / 1000) + 's'
						cdsi.distinctPeople = asyncComputed(getCohortCount, this, source);
					} else {
						cdsi.isValid = false;
						cdsi.status = 'n/a';
						cdsi.startTime = 'n/a';
						cdsi.executionDuration = 'n/a';
						cdsi.distinctPeople = 'n/a';
					}

					results.push(cdsi);
				}

				self.cohortDefinitionSourceInfo(results);

				// load universe of analyses
				var analysesPromise = $.ajax({
					url: self.services()[0].url + 'cohortanalysis/',
					method: 'GET',
					contentType: 'application/json',
					success: function (analyses) {
						var index = {};
						var nestedAnalyses = [];

						for (var a = 0; a < analyses.length; a++) {
							var analysis = analyses[a];

							if (index[analysis.analysisType] == undefined) {
								var analysisType = {
									name: analysis.analysisType,
									analyses: []
								};
								nestedAnalyses.push(analysisType);
								index[analysis.analysisType] = nestedAnalyses.indexOf(analysisType);
							}
							self.analysisLookup[analysis.analysisId] = analysis.analysisType;
							nestedAnalyses[index[analysis.analysisType]].analyses.push(analysis);
						}

						self.cohortAnalyses(nestedAnalyses);

						// obtain completed result status for each source
						for (var s = 0; s < cdmSources.length; s++) {
							var source = cdmSources[s];
							var info = getSourceInfo(source);
							if (info) {
								var sourceAnalysesStatus = {};
								sourceAnalysesStatus.checking = true;
								self.sourceAnalysesStatus[source.sourceKey](sourceAnalysesStatus);
								getCompletedAnalyses(source);
							}
						}
					}
				});

				self.currentView('cohortdefinition');
			});
		}

		self.search = function (query) {
			self.currentView('loading');

			filters = [];
			$('#querytext').blur();

			$.ajax({
				url: self.vocabularyUrl() + 'search/' + query,
				success: function (results) {
					if (results.length == 0) {
						self.currentView('search');
						$('#modalNoSearchResults').modal('show');
						return;
					}

					var searchResultIdentifiers = [];
					for (c = 0; c < results.length; c++) {
						searchResultIdentifiers.push(results[c].CONCEPT_ID);
					}

					// load data density
					var densityPromise = $.Deferred();
					var densityIndex = {};

					$.ajax({
						url: self.resultsUrl() + 'conceptDensity',
						method: 'POST',
						contentType: 'application/json',
						timeout: 10000,
						data: JSON.stringify(searchResultIdentifiers),
						success: function (entries) {
							for (var e = 0; e < entries.length; e++) {
								densityIndex[entries[e].key] = entries[e].value;
							}
							densityPromise.resolve();
						},
						error: function (error) {
							densityPromise.resolve();
						}
					});

					$.when(densityPromise).done(function () {
						feTemp = new FacetEngine({
							Facets: [
								{
									'caption': 'Vocabulary',
									'binding': function (o) {
										return o.VOCABULARY_ID;
									}
						},
								{
									'caption': 'Class',
									'binding': function (o) {
										return o.CONCEPT_CLASS_ID;
									}
						},
								{
									'caption': 'Domain',
									'binding': function (o) {
										return o.DOMAIN_ID;
									}
						},
								{
									'caption': 'Standard Concept',
									'binding': function (o) {
										return o.STANDARD_CONCEPT_CAPTION;
									}
						},
								{
									'caption': 'Invalid Reason',
									'binding': function (o) {
										return o.INVALID_REASON_CAPTION;
									}
						},
								{
									'caption': 'Has Data',
									'binding': function (o) {
										return o.DENSITY > 0;
									}
						}
					]
						});

						for (c = 0; c < results.length; c++) {
							var concept = results[c];
							if (densityIndex[concept.CONCEPT_ID] != undefined) {
								concept.DENSITY = densityIndex[concept.CONCEPT_ID];
							} else {
								concept.DENSITY = 0;
							}

							feTemp.Process(concept);
						}

						feTemp.MemberSortFunction = function () {
							return this.ActiveCount
						};
						feTemp.sortFacetMembers();

						self.feSearch(feTemp);

						var tempCaption;

						if (decodeURI(query).length > 20) {
							tempCaption = decodeURI(query).substring(0, 20) + '...';
						} else {
							tempCaption = decodeURI(query);
						}

						lastQuery = {
							query: query,
							caption: tempCaption,
							resultLength: results.length
						};
						self.currentSearch(query);

						var exists = false;
						for (i = 0; i < self.recentSearch().length; i++) {
							if (self.recentSearch()[i].query == query)
								exists = true;
						}
						if (!exists) {
							self.recentSearch.unshift(lastQuery);
						}
						if (self.recentSearch().length > 7) {
							self.recentSearch.pop();
						}

						self.currentView('searchResults');
						self.searchResultsConcepts(self.feSearch().GetCurrentObjects());
					});
				},
				error: function (xhr, message) {
					alert('error while searching ' + message);
				}
			});
		}

		self.loadConcept = function (conceptId) {
			self.currentView('loading');

			var conceptPromise = $.ajax({
				url: self.vocabularyUrl() + 'concept/' + conceptId,
				method: 'GET',
				contentType: 'application/json',
				success: function (c, status, xhr) {
					var exists = false;
					for (i = 0; i < self.recentConcept().length; i++) {
						if (self.recentConcept()[i].CONCEPT_ID == c.CONCEPT_ID)
							exists = true;
					}
					if (!exists) {
						self.recentConcept.unshift(c);
					}
					if (self.recentConcept().length > 7) {
						self.recentConcept.pop();
					}

					self.currentConcept(c);
					self.currentView('concept');
				},
				error: function () {
					alert('An error occurred while attempting to load the concept from your currently configured provider.  Please check the status of your selection from the configuration button in the top right corner.');
				}
			});

			// load related concepts once the concept is loaded
			self.loadingRelated(true);
			var relatedPromise = $.Deferred();

			$.when(conceptPromise).done(function () {
				metarchy = {
					parents: ko.observableArray(),
					children: ko.observableArray(),
					synonyms: ko.observableArray()
				};

				$.getJSON(self.vocabularyUrl() + 'concept/' + conceptId + '/related', function (related) {
					self.relatedConcepts(related);

					var feTemp = new FacetEngine({
						Facets: [
							{
								'caption': 'Vocabulary',
								'binding': function (o) {
									return o.VOCABULARY_ID;
								}
							},
							{
								'caption': 'Standard Concept',
								'binding': function (o) {
									return o.STANDARD_CONCEPT_CAPTION;
								}
							},
							{
								'caption': 'Invalid Reason',
								'binding': function (o) {
									return o.INVALID_REASON_CAPTION;
								}
							},
							{
								'caption': 'Class',
								'binding': function (o) {
									return o.CONCEPT_CLASS_ID;
								}
							},
							{
								'caption': 'Domain',
								'binding': function (o) {
									return o.DOMAIN_ID;
								}
							},
							{
								'caption': 'Relationship',
								'binding': function (o) {
									values = [];
									for (i = 0; i < o.RELATIONSHIPS.length; i++) {
										values.push(o.RELATIONSHIPS[i].RELATIONSHIP_NAME);
									}
									return values;
								}
							},
							{
								'caption': 'Distance',
								'binding': function (o) {
									values = [];
									for (i = 0; i < o.RELATIONSHIPS.length; i++) {
										if (values.indexOf(o.RELATIONSHIPS[i].RELATIONSHIP_DISTANCE) == -1) {
											values.push(o.RELATIONSHIPS[i].RELATIONSHIP_DISTANCE);
										}
									}
									return values;
								}
							}
						]
					});

					for (c = 0; c < related.length; c++) {
						feTemp.Process(related[c]);
						metagorize(metarchy, related[c]);
					}

					self.metarchy = metarchy;

					feTemp.MemberSortFunction = function () {
						return this.ActiveCount;
					};
					feTemp.sortFacetMembers();

					self.feRelated(feTemp);
					self.relatedConcepts(self.feRelated().GetCurrentObjects());
					relatedPromise.resolve();
				});
			});

			$.when(relatedPromise).done(function () {
				self.loadingRelated(false);
			});

			// triggers once our async loading of the concept and related concepts is complete
			$.when(conceptPromise).done(function () {
				self.currentView('concept');
			});
		}

		self.reportCohortDefinitionId = ko.observable();
		self.reportReportName = ko.observable();
		self.reportSourceKey = ko.observable();
		self.reportValid = ko.computed(function () {
			return (self.reportReportName() != undefined && self.reportSourceKey() != undefined && self.reportCohortDefinitionId() != undefined && !self.loadingReport() && !self.loadingReportDrilldown());
		}, this);
		self.jobs = ko.observableArray();
		self.sourceAnalysesStatus = {};
		self.analysisLookup = {};
		self.cohortDefinitionSourceInfo = ko.observableArray();
		self.recentSearch = ko.observableArray(null);
		self.recentConcept = ko.observableArray(null);
		self.currentSearch = ko.observable();
		self.currentView = ko.observable();
		self.conceptSetInclusionIdentifiers = ko.observableArray();
		self.currentConceptSetExpressionJson = ko.observable();
		self.currentConceptIdentifierList = ko.observable();
		self.currentIncludedConceptIdentifierList = ko.observable();
		self.searchResultsConcepts = ko.observableArray();
		self.relatedConcepts = ko.observableArray();
		self.importedConcepts = ko.observableArray();
		self.includedConcepts = ko.observableArray();
		self.cohortDefinitions = ko.observableArray();
		self.currentCohortDefinition = ko.observable();
		self.currentCohortDefinitionInfo = ko.observable();
		self.resolvingConceptSetExpression = ko.observable();
		self.evidence = ko.observableArray();
		self.services = ko.observableArray([
			/*
			{
				name: 'HixBeta Multihomed',
				url: 'http://hixbeta.jnj.com:8081/WebAPI/'
			},
			*/
			{
				name: 'Local',
				url: 'http://localhost:8080/WebAPI/'
			}
		]);
		self.initializationErrors = 0;
		self.vocabularyUrl = ko.observable();
		self.evidenceUrl = ko.observable();
		self.resultsUrl = ko.observable();
		self.currentConcept = ko.observable();
		self.currentConceptMode = ko.observable('details');
		self.currentConceptMode.subscribe(function (newMode) {
			switch (newMode) {
			case 'evidence':
				// load evidence
				self.loadingEvidence(true);
				var evidencePromise = $.ajax({
					url: self.evidenceUrl() + self.currentConcept().CONCEPT_ID,
					method: 'GET',
					contentType: 'application/json',
					success: function (evidence) {
						self.evidence(evidence);
						self.loadingEvidence(false);

						var evidenceData = [];
						var evidenceSource = {
							name: 'source',
							values: []
						};
						evidenceData.push(evidenceSource);
						var evidenceCount = 0;
						for (var i = 0; i < evidence.length; i++) {
							if (evidence[i].evidenceType == 'MEDLINE_MeSH_CR') {
								var e = {
									evidenceType: evidence[i].evidenceType,
									label: evidence[i].drugName,
									xValue: evidenceCount++,
									yValue: evidence[i].value
								};
								evidenceSource.values.push(e);
							}
						}

						var scatter = new jnj_chart.scatterplot();
						scatter.render(evidenceData, "#conceptEvidenceScatter", 460, 150, {
							yFormat: d3.format('0'),
							xValue: "xValue",
							yValue: "yValue",
							xLabel: "Drugs",
							yLabel: "Raw Value",
							seriesName: "evidenceType",
							showLegend: false,
							tooltips: [{
								label: 'Drug',
								accessor: function (o) {
									return o.label;
								}
						}, {
								label: 'Raw Value',
								accessor: function (o) {
									return o.yValue;
								}
						}],
							colors: d3.scale.category10(),
							showXAxis: false
						});
					},
					error: function () {
						self.loadingEvidence(false);
					}
				});
				break;
			}
		});
		self.renderCurrentConceptSelector = function () {
			var css = '';
			if (self.selectedConceptsIndex[self.currentConcept().CONCEPT_ID] == 1) {
				css = ' selected';
			}
			return '<i class="fa fa-shopping-cart' + css + '"></i>';
		}
		self.currentConceptSetMode = ko.observable('details');
		self.currentImportMode = ko.observable('identifiers');
		self.feRelated = ko.observable();
		self.feSearch = ko.observable();
		self.metarchy = {};
		self.prompts = ko.observableArray(); // todo: remove?
		self.selectedConcepts = ko.observableArray(null);
		self.selectedConceptsWarnings = ko.observableArray();
		self.checkCurrentSource = function (source) {
			return source.url == self.curentVocabularyUrl();
		};
		self.renderHierarchyLink = function (d) {
			var valid = d.INVALID_REASON_CAPTION == 'Invalid' || d.STANDARD_CONCEPT != 'S' ? 'invalid' : '';
			return '<a class="' + valid + '" href=\"#/concept/' + d.CONCEPT_ID + '\">' + d.CONCEPT_NAME + '</a>';
		};
		self.loadJobs = function () {
			$.ajax({
				url: self.services()[0].url + 'job/execution?comprehensivePage=true',
				method: 'GET',
				contentType: 'application/json',
				success: function (jobs) {
					for (var j = 0; j < jobs.content.length; j++) {
						var startDate = new Date(jobs.content[j].startDate);
						jobs.content[j].startDate = startDate.toLocaleDateString() + ' ' + startDate.toLocaleTimeString();

						var endDate = new Date(jobs.content[j].endDate);
						jobs.content[j].endDate = endDate.toLocaleDateString() + ' ' + endDate.toLocaleTimeString();

						if (jobs.content[j].jobParameters.jobName == undefined) {
							jobs.content[j].jobParameters.jobName = 'n/a';
						}
					}
					self.jobs(jobs.content);
					self.currentView('jobs');
				}
			});
		};
		self.analyzeSelectedConcepts = function () {
			self.selectedConceptsWarnings.removeAll();
			var domains = [];
			var standards = [];
			var includeNonStandard = false;

			for (var i = 0; i < self.selectedConcepts().length; i++) {
				var domain = self.selectedConcepts()[i].concept.DOMAIN_ID;
				var standard = self.selectedConcepts()[i].concept.STANDARD_CONCEPT_CAPTION;

				if (standard != 'Standard') {
					includeNonStandard = true;
				}

				var index;

				index = $.inArray(domain, domains);
				if (index < 0) {
					domains.push(domain);
				}

				index = $.inArray(standard, standards);
				if (index < 0) {
					standards.push(standard);
				}

			}

			if (domains.length > 1) {
				self.selectedConceptsWarnings.push('Your saved concepts come from multiple Domains (' + domains.join(', ') + ').  A useful set of concepts will typically all come from the same Domain.');
			}

			if (standards.length > 1) {
				self.selectedConceptsWarnings.push('Your saved concepts include different standard concept types (' + standards.join(', ') + ').  A useful set of concepts will typically all be of the same standard concept type.');
			}

			if (includeNonStandard) {
				self.selectedConceptsWarnings.push('Your saved concepts include Non-Standard or Classification concepts.  Typically concept sets should only include Standard concepts unless advanced use of this concept set is planned.');
			}
		};
		self.selectedConceptsIndex = {};
		self.createConceptSetItem = function (concept) {
			var conceptSetItem = {};

			conceptSetItem.concept = concept;
			conceptSetItem.isExcluded = ko.observable(false);
			conceptSetItem.includeDescendants = ko.observable(false);
			conceptSetItem.includeMapped = ko.observable(false);
			return conceptSetItem;
		};
		self.conceptSetInclusionCount = ko.observable(0);
		self.resolveConceptSetExpression = function () {
			self.resolvingConceptSetExpression(true);
			var conceptSetExpression = '{"items" :' + ko.toJSON(self.selectedConcepts()) + '}';
			var highlightedJson = self.syntaxHighlight(conceptSetExpression);
			self.currentConceptSetExpressionJson(highlightedJson);

			$.ajax({
				url: self.vocabularyUrl() + 'resolveConceptSetExpression',
				data: conceptSetExpression,
				method: 'POST',
				contentType: 'application/json',
				success: function (info) {
					self.conceptSetInclusionIdentifiers(info);
					self.currentIncludedConceptIdentifierList(info.join(','));
					self.conceptSetInclusionCount(info.length);
					self.resolvingConceptSetExpression(false);
				},
				error: function (err) {
					alert(err);
					self.resolvingConceptSetExpression(false);
				}
			});
		};
		self.syntaxHighlight = function (json) {
			if (typeof json != 'string') {
				json = JSON.stringify(json, undefined, 2);
			}
			json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
				var cls = 'number';
				if (/^"/.test(match)) {
					if (/:$/.test(match)) {
						cls = 'key';
					} else {
						cls = 'string';
					}
				} else if (/true|false/.test(match)) {
					cls = 'boolean';
				} else if (/null/.test(match)) {
					cls = 'null';
				}
				return '<span class="' + cls + '">' + match + '</span>';
			});
		};
		self.updateSearchFilters = function () {
			$(event.target).toggleClass('selected');

			var filters = [];
			$('#wrapperSearchResultsFilter .facetMemberName.selected').each(function (i, d) {
				filters.push(d.id);
			});
			self.feSearch().SetFilter(filters);
			// update filter data binding
			self.feSearch(self.feSearch());
			// update table data binding
			self.searchResultsConcepts(self.feSearch().GetCurrentObjects());
		};
		self.updateRelatedFilters = function () {
			$(event.target).toggleClass('selected');

			var filters = [];
			$('#wrapperRelatedConceptsFilter .facetMemberName.selected').each(function (i, d) {
				filters.push(d.id);
			});
			self.feRelated().SetFilter(filters);
			// update filter data binding
			self.feRelated(self.feRelated());
			// update table data binding
			self.relatedConcepts(self.feRelated().GetCurrentObjects());
		};
		self.selectConcept = function (concept) {
			document.location = '#/concept/' + concept.CONCEPT_ID;
		};
	}
	return appModel;
});