//      xiNET interaction viewer
//      Copyright 2013 Rappsilber Laboratory

// reads our MI JSON format 
xiNET.Controller.prototype.readMIJSON = function(miJson) {
    //just check that we've got a parsed javacsript object here, not a String
    miJson = (typeof miJson === 'object') ? miJson : JSON.parse(decodeURIComponent(layoutJSON));
	
	//we're gonna need to keep track of what things have missing sequences 
    var proteinsMissingSequence = d3.set();
    
    // we iterate through the data twice, once for interactors and once for interactions
    // (iteractors and interactions are mixed together in 'data')
    // the second iteration is in the 'addInteractions' function below
    
    var data = miJson.data;
    var dataElementCount = data.length;
    for (var n = 0; n < dataElementCount; n++) {
        if (data[n].object === 'interactor') {
            var interactor = data[n];
            var p = new Interactor(interactor.identifier.id, this, interactor);
            this.proteins.set(interactor.identifier.id, p);
            var organismText = "no organism data";
            if (interactor.organism) {
                organismText = interactor.organism.scientific + '(' + interactor.organism.common + ')';
            }
            var description = interactor.type.name + ', '
                    + organismText + ', '
                    + interactor.identifier.id;

            if (typeof interactor.sequence !== 'undefined') {
                p.initProtein(interactor.sequence, interactor.label, description);
            }
            else {
                if (interactor.identifier.db === 'uniprotkb') {
                    proteinsMissingSequence.add(interactor.identifier.id);
                }
                else {
                    p.initProtein('MISSING', interactor.label, description);
                }
            }
        }
    }
    var self = this;// the javascript bodge 

    //we will download missing sequences before doing second iteration to add interactions
    if (proteinsMissingSequence.values().length === 0) {//if no missing sequences
        addInteractions();
    }
    else {
        this.message(proteinsMissingSequence);
        initProteinSequences();//calls addInteractions when complete
    }
    
    function initProteinSequences() {
        var server_url = 'http://www.ebi.ac.uk/das-srv/uniprot/das/uniprot/';
        var client = JSDAS.Simple.getClient(server_url);
        // This function will be executed in case of error
        var error_response = function(e) {
            //we need to parse id out of URL, this is not ideal
            var id = e.url.substring(e.url.lastIndexOf('=') + 1);
            console.error('Sequence DAS lookup FAILED for ' + id);
            console.error(e.url);
            var p = self.proteins.get(id);
            p.initProtein('MISSING');
            proteinsMissingSequence.remove(id);
            self.message('<p>Waiting on sequence DAS response for: '
                    + proteinsMissingSequence.values().toString() + '</p>');
            if (proteinsMissingSequence.values().length === 0) {
                self.message('<p>All DAS sequence queries returned</p>');
                addInteractions();
            }
        };
        // This function inits the protein with sequence
        var response = function(res) {
            var id = res.SEQUENCE[0].id;
            var seq = res.SEQUENCE[0].textContent;
            var label = res.SEQUENCE[0].label;
            var prot = self.proteins.get(id);
            prot.initProtein(seq, label, id);
            proteinsMissingSequence.remove(id);
            self.message('<p>Waiting on sequence DAS response for: '
                    + proteinsMissingSequence.values().toString() + '</p>');
            if (proteinsMissingSequence.values().length === 0) {
                self.message('<p>All sequences downloaded from DAS</p>');
                addInteractions();
            }
        };

        //send off the DAS sequence requests
        var keys = proteinsMissingSequence.values();
        var proteinCount = keys.length;
        for (var p = 0; p < proteinCount; p++) {
            var accession = keys[p];
            //Asking the client to retrieve the sequence
            client.sequence({
                segment: accession
            }, response, error_response);
        }
    }

    function addInteractions() {
        var width = self.svgElement.parentNode.clientWidth;
        Interactor.UNITS_PER_RESIDUE = ((width / 2)) / 2000;//((Interactor.MAXSIZE < 5000)? Interactor.MAXSIZE : 5000);
        var proteins = self.proteins.values();
        var proteinCount = proteins.length;
        for (var p = 0; p < proteinCount; p++) {
            proteins[p].initStick();
        }
        for (var l = 0; l < dataElementCount; l++) {
            var interaction = data[l];
            if (interaction.object === 'interaction') {
                self.addInteraction(interaction);
            }
        }
        for (var p = 0; p < proteinCount; p++) {
            var prot = proteins[p];
            prot.setPositionalFeatures(prot.customAnnotations);
        }
        self.init();
        self.checkLinks();
    }
};

//~ xiNET.Controller.prototype.addInteractor = function(interaction) {
	//~ 
//~ }

xiNET.Controller.prototype.addInteraction = function(interaction) {
    
    if (typeof interaction.identifiers === 'undefined' || interaction.identifiers.length === 0){
        alert('missing interaction identifier');
        console.error(JSON.stringify(interaction));
    }
    
    if (typeof interaction.confidences !== 'undefined') {
        var confidences = interaction.confidences;
        var confCount = confidences.length;
        for (var c = 0; c < confCount; c++){
            var conf = confidences[c];
            if (conf.type === 'intact-miscore'){
                interaction.score = conf.value * 1.0;
            }
        }
    }
    
    var sourceInteractor = this.proteins.get(interaction.source.identifier.id);
    if (typeof sourceInteractor === 'undefined') {
        alert("Fail - no interactor with id " + interaction.source.identifier.id);
    }
    var targetInteractor = this.proteins.get(interaction.target.identifier.id);
    if (typeof targetInteractor === 'undefined') {
        alert("Fail - no interactor with id " + interaction.target.identifier.id);
    }
    // these links are undirected and should have same ID regardless of which way round 
    // source and target are
    var linkID;
    if (interaction.source.identifier.id < interaction.target.identifier.id) {
        linkID = interaction.source.identifier.id + '_' + interaction.target.identifier.id;
    } else {
        linkID = interaction.target.identifier.id + '_' + interaction.source.identifier.id;
    }
    var link = this.proteinLinks.get(linkID);
    if (typeof link === 'undefined') {
        if (interaction.source.identifier.id < interaction.target.identifier.id) {
            link = new InteractorLink(linkID, sourceInteractor, targetInteractor, this);
        } else {
            link = new InteractorLink(linkID, targetInteractor, sourceInteractor, this);
        }
        this.proteinLinks.set(linkID, link);
        sourceInteractor.addLink(link);
        targetInteractor.addLink(link);
    }
    //all other initialisation to do with interactions takes place within InteractorLink 
    link.addEvidence(interaction);
};
